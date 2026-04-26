"""
FastAPI backend for the Novel Proofreader system.
Serves the frontend static files and provides all API endpoints.
"""
import json
import logging
import sys
import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set
import re

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import rag
import tasks
from config import DATA_DIR, RESULTS_DIR, NAMES_DICT_PATH, NOVEL_NAMES_PATH, LOGS_DIR, USE_LOCAL_VLLM

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s – %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)

app = FastAPI(title="Novel Proofreader API", version="1.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global Batch State ─────────────────────────────────────────────────────────
batch_status: Dict[str, dict] = {} # novel_id -> {total, current, status}
stop_requested: Set[str] = set()

# ── Pydantic models ─────────────────────────────────────────────────────────────

class MarkRequest(BaseModel):
    novel_id: str
    chapter: str
    text: str
    use_cache: bool = True

class BatchMarkRequest(BaseModel):
    novel_id: str
    files: List[dict] # {filename, content, chapter}
    use_cache: bool = True

class BatchScanRequest(BaseModel):
    novel_id: str
    use_cache: bool = True
    tasks: List[str] = ["mark"] # ["mark", "chars", "events", "summary"]

class Decision(BaseModel):
    id: str
    type: str
    original: str
    suggestion: str
    start: int
    end: int
    action: str
    manual_text: str = ""

class ApplyRequest(BaseModel):
    novel_id: str
    chapter: str
    text: str
    decisions: List[Decision]

class AnalyzeRequest(BaseModel):
    novel_id: str
    chapter: str = ""
    text: str
    use_cache: bool = True

class TimelineRequest(BaseModel):
    novel_id: str
    events: List[dict]

class ExportRequest(BaseModel):
    novel_id: str
    data: dict

class SummaryRequest(BaseModel):
    novel_id: str
    chunks: List[str]

# ── API Routes ──────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}

# --- Local File System Explorer ---
NOVEL_BASE_DIR = Path("c:/Users/user/Downloads/novel")

@app.get("/api/fs/novels")
async def list_novels():
    """Lists directories in the novel base directory that contain table.txt."""
    mapping = {}
    if NOVEL_NAMES_PATH.exists():
        try:
            mapping = json.loads(NOVEL_NAMES_PATH.read_text("utf-8"))
        except: pass
        
    items = []
    try:
        for entry in NOVEL_BASE_DIR.iterdir():
            if entry.is_dir() and not entry.name.startswith("."):
                if (entry / "table.txt").exists():
                    items.append({
                        "name": entry.name,
                        "display_name": mapping.get(entry.name, entry.name),
                        "path": entry.name
                    })
    except Exception as e:
        log.error(f"FS List Novel error: {e}")
    return {"novels": sorted(items, key=lambda x: x["display_name"])}

def _read_file_content(path: Path) -> str:
    """Helper to read text with robust encoding detection."""
    content_bytes = path.read_bytes()
    for enc in ("utf-8", "utf-8-sig", "gbk", "big5", "utf-16"):
        try:
            return content_bytes.decode(enc)
        except: continue
    return content_bytes.decode("utf-8", errors="ignore")

@app.get("/api/fs/chapters")
async def list_chapters(novel_path: str, include_cache: bool = False):
    """Lists .txt files within a novel directory, excluding table.txt."""
    target = (NOVEL_BASE_DIR / novel_path).resolve()
    if not str(target).startswith(str(NOVEL_BASE_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    
    items = []
    try:
        for entry in target.iterdir():
            if entry.is_file() and entry.suffix.lower() == ".txt" and entry.name.lower() != "table.txt":
                item = {
                    "name": entry.name,
                    "path": str(entry.relative_to(NOVEL_BASE_DIR)).replace("\\", "/")
                }
                if include_cache:
                    # Quick path-based check for existence, much faster than hashing content
                    mark_exists = tasks.get_cache_path("mark", novel_path, entry.name).exists()
                    events_exists = tasks.get_cache_path("events", novel_path, entry.name).exists()
                    applied_exists = tasks.get_cache_path("mark", novel_path, entry.name).with_suffix(".applied").exists()
                    item["cache"] = {
                        "mark": mark_exists,
                        "events": events_exists,
                        "applied": applied_exists,
                        "done": mark_exists or applied_exists
                    }
                items.append(item)
    except Exception as e:
        log.error(f"FS List Chapter error: {e}")
        
    def natural_sort_key(s):
        return [int(text) if text.isdigit() else text.lower()
                for text in re.split('([0-9]+)', s)]

    return {"chapters": sorted(items, key=lambda x: natural_sort_key(x["name"]))}

@app.get("/api/fs/read")
async def read_file(path: str):
    """Reads a text file from the local filesystem."""
    target = (NOVEL_BASE_DIR / path).resolve()
    if not str(target).startswith(str(NOVEL_BASE_DIR.resolve())):
        raise HTTPException(403, "Access denied")
    
    if not target.is_file():
        raise HTTPException(404, "File not found")
        
    try:
        content = _read_file_content(target)
        return {"content": content, "filename": target.name}
    except Exception as e:
        raise HTTPException(400, f"Read error: {e}")
    
@app.post("/api/cache/check")
async def check_cache(req: AnalyzeRequest):
    """Checks if analysis cache exists for the given content."""
    res = {}
    
    # Check each type using new path-based load_cache
    m = tasks.load_cache("mark", req.novel_id, req.chapter, req.text)
    if m: res["mark"] = m
    
    c = tasks.load_cache("chars", req.novel_id, "global", req.text)
    if c: res["chars"] = c
    
    e = tasks.load_cache("events", req.novel_id, req.chapter, req.text)
    if e: res["events"] = e
    
    s = tasks.load_cache("summary", req.novel_id, "global", req.text)
    if s: res["summary"] = s
    
    return res

# --- Processing Endpoints ---

def _create_batch_status(total: int) -> dict:
    return {
        "total": total,
        "current": 0,
        "failed": 0,
        "failed_files": [],
        "last_chapter": None,
        "status": "processing",
        "start_time": datetime.now(timezone.utc).isoformat()
    }

@app.post("/api/mark")
async def api_mark_errors(req: MarkRequest):
    result = await tasks.run_mark_errors(req.novel_id, req.chapter, req.text, req.use_cache)
    return result

@app.post("/api/batch/scan")
async def api_batch_scan(req: BatchScanRequest, background_tasks: BackgroundTasks):
    novel_id = req.novel_id
    novel_dir = NOVEL_BASE_DIR / novel_id
    if not novel_dir.exists():
        raise HTTPException(404, "Novel not found")

    # Get all .txt files except table.txt
    files = [f for f in novel_dir.glob("*.txt") if f.name.lower() != "table.txt"]
    files = sorted(files, key=lambda x: [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', x.name)])
    batch_status[novel_id] = _create_batch_status(len(files))
    
    async def process_all():
        all_chars = []
        all_summaries = []
        all_events = []
        
        for i, f_path in enumerate(files):
            if novel_id in stop_requested:
                log.info(f"Stop requested for {novel_id}, terminating batch scan.")
                batch_status[novel_id]["status"] = "stopped"
                stop_requested.remove(novel_id)
                return # Exit immediately
                
            try:
                content = f_path.read_text("utf-8", errors="ignore")
                
                # 1. Check for skips if use_cache is on
                if req.use_cache:
                    has_mark = tasks.get_cache_path("mark", novel_id, f_path.name).exists()
                    has_chars = tasks.get_cache_path("chars", novel_id, f_path.name).exists()
                    # If all requested tasks already have cache, skip this file entirely
                    all_done = True
                    for t in req.tasks:
                        if t == "mark" and not has_mark: all_done = False
                        if t == "chars" and not has_chars: all_done = False
                        if t == "summary" and not tasks.get_cache_path("summary", novel_id, f_path.name).exists(): all_done = False
                    
                    if all_done:
                        # Even if skipped, we should load existing cache into memory for global update
                        if "chars" in req.tasks:
                            c_cached = tasks.load_cache("chars", novel_id, f_path.name, content)
                            if c_cached: all_chars.extend(c_cached)
                        if "summary" in req.tasks:
                            s_cached = tasks.load_cache("summary", novel_id, f_path.name, content)
                            if s_cached: all_summaries.append(f"### {f_path.name}\n{s_cached}")
                        
                        batch_status[novel_id]["current"] = i + 1
                        continue

                # 2. Execute requested tasks (only if not skipped)
                if "mark" in req.tasks:
                    await tasks.run_mark_errors(novel_id, f_path.name, content, use_cache=req.use_cache)
                
                if "chars" in req.tasks:
                    c_list = await tasks.run_extract_characters(novel_id, f_path.name, content, use_cache=req.use_cache)
                    if isinstance(c_list, list) and c_list:
                        all_chars.extend(c_list)
                
                if "events" in req.tasks:
                    evs = await tasks.run_extract_events(novel_id, f_path.name, content, use_cache=req.use_cache)
                    if evs: all_events.extend(evs)
                
                if "summary" in req.tasks:
                    s = await tasks.run_extract_summary(novel_id, f_path.name, [content[:4000]], use_cache=req.use_cache)
                    if s: all_summaries.append(f"### {f_path.name}\n{s}")

                batch_status[novel_id]["current"] = i + 1
                batch_status[novel_id]["last_chapter"] = f_path.name
                
                # INCREMENTAL SAVE: Only pass the NEW items found in THIS chapter
                if ( "mark" not in req.tasks or True ): # Always check if we have something to save
                    new_chars = c_list if "chars" in req.tasks and 'c_list' in locals() else []
                    new_summaries = [f"### {f_path.name}\n{s}"] if "summary" in req.tasks and 's' in locals() else []
                    new_events = evs if "events" in req.tasks and 'evs' in locals() else []
                    
                    if new_chars or new_summaries or new_events:
                        _update_novel_results_from_batch(novel_id, new_chars, new_summaries, new_events)

            except Exception as e:
                log.error(f"Scan batch error for {f_path.name}: {e}")
                batch_status[novel_id]["failed"] += 1
                batch_status[novel_id]["failed_files"].append(f_path.name)
                batch_status[novel_id]["current"] = i + 1
        
        # After all chapters, update global novel results if chars or summary were requested
        if all_chars or all_summaries or all_events:
            # Build timeline if events were collected
            timeline = []
            if all_events:
                timeline = await tasks.run_build_timeline(novel_id, all_events)
                
            _update_novel_results_from_batch(novel_id, all_chars, all_summaries, timeline)
            
        batch_status[novel_id]["status"] = "done"

    background_tasks.add_task(process_all)
    return {"message": "Scan started", "total": len(files)}


def _update_novel_results_from_batch(novel_id, chars, summaries, timeline):
    res_path = RESULTS_DIR / f"{novel_id}.json"
    data = {"characters": [], "summary": "", "timeline": [], "novel": novel_id}
    if res_path.exists():
        try: 
            content = res_path.read_text("utf-8").strip()
            if content:
                data = json.loads(content)
        except Exception as e:
            log.error(f"Failed to load existing results: {e}")
        
    if chars:
        # Deduplicate and merge characters with alias awareness
        existing_chars = data.get("characters", [])
        
        # Build a map of Name -> Canonical Character AND Alias -> Canonical Character
        name_to_char = {}
        alias_to_canonical = {}
        for c in existing_chars:
            main_name = c.get('角色名稱')
            if not main_name: continue
            name_to_char[main_name] = c
            alias_to_canonical[main_name] = main_name
            for alias in c.get('別名', []):
                alias_to_canonical[alias] = main_name
        
        for c in chars:
            new_name = c.get("角色名稱")
            if not new_name: continue
            
            # Check if this name is actually an alias of an existing character
            canonical_name = alias_to_canonical.get(new_name)
            
            if canonical_name and canonical_name in name_to_char:
                # Merge into existing canonical character
                target = name_to_char[canonical_name]
                for key, value in c.items():
                    if key == "角色名稱": continue
                    if key == "別名":
                        # Merge aliases
                        existing_aliases = set(target.get("別名", []))
                        if isinstance(value, list):
                            for v in value: existing_aliases.add(v)
                        else:
                            existing_aliases.add(value)
                        # Remove the canonical name from aliases if it sneaked in
                        if canonical_name in existing_aliases: existing_aliases.remove(canonical_name)
                        target["別名"] = list(existing_aliases)
                    elif key == "角色描述":
                        # Always trust the new synthesized description if it's substantial
                        if value and len(value) > len(target.get(key, "")):
                            target[key] = value
                    elif not target.get(key) and value:
                        target[key] = value
            else:
                # Truly a new character
                name_to_char[new_name] = c
                alias_to_canonical[new_name] = new_name
                for alias in c.get('別名', []):
                    alias_to_canonical[alias] = new_name
                    
        data["characters"] = list(name_to_char.values())
        
    if summaries:
        existing_summary = data.get("summary", "")
        # Append new summaries if they aren't already in the text (simple check)
        for s in summaries:
            # Check if this chapter's summary (or title) is already present
            # We used "### ChapterName" as header
            chapter_header = s.split('\n')[0] 
            if chapter_header not in existing_summary:
                if existing_summary:
                    existing_summary += "\n\n" + s
                else:
                    existing_summary = s
        data["summary"] = existing_summary
    
    if timeline:
        existing_timeline = data.get("timeline", [])
        # Deduplicate based on Event Name and Chapter (case-insensitive)
        seen = set()
        unique_timeline = []
        
        # Combine both existing and new
        for ev in existing_timeline + timeline:
            key = (ev.get("事件名稱", "").strip().lower(), ev.get("章節", "").strip().lower())
            if key not in seen:
                seen.add(key)
                unique_timeline.append(ev)
        
        # Re-sort by chapter name (numeric-aware)
        data["timeline"] = sorted(unique_timeline, key=lambda x: [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', x.get("章節", ""))])
    
    res_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")

@app.post("/api/batch/mark")
async def api_batch_mark(req: BatchMarkRequest, background_tasks: BackgroundTasks):
    novel_id = req.novel_id
    batch_status[novel_id] = _create_batch_status(len(req.files))
    
    async def process_batch():
        for i, f in enumerate(req.files):
            if novel_id in stop_requested:
                log.info(f"Stop requested for batch mark {novel_id}")
                batch_status[novel_id]["status"] = "stopped"
                stop_requested.remove(novel_id)
                return
                
            try:
                await tasks.run_mark_errors(novel_id, f["chapter"], f["content"], use_cache=True)
                batch_status[novel_id]["current"] = i + 1
            except Exception as e:
                log.error(f"Batch process error for {f['filename']}: {e}")
                batch_status[novel_id]["failed"] += 1
                batch_status[novel_id]["failed_files"].append(f["filename"])
                batch_status[novel_id]["current"] = i + 1
        
        if batch_status[novel_id]["status"] == "processing":
            batch_status[novel_id]["status"] = "done"

    background_tasks.add_task(process_batch)
    return {"message": "Batch started", "total": len(req.files)}

@app.post("/api/batch/stop/{novel_id}")
async def api_stop_batch(novel_id: str):
    if novel_id in batch_status and batch_status[novel_id]["status"] == "processing":
        stop_requested.add(novel_id)
        return {"success": True, "message": "Stop requested"}
    return {"success": False, "message": "Not running"}

@app.get("/api/batch/status/{novel_id}")
async def get_batch_status(novel_id: str):
    return batch_status.get(novel_id, {"status": "not_found", "total": 0, "current": 0, "failed": 0, "failed_files": [], "start_time": None})

@app.post("/api/apply")
async def api_apply_corrections(req: ApplyRequest):
    decisions = [d.model_dump() for d in req.decisions]
    new_text, log_entries = tasks.apply_corrections(req.text, decisions, req.novel_id, req.chapter)
    
    # Overwrite the original file
    original_path = NOVEL_BASE_DIR / req.novel_id / (req.chapter if req.chapter.endswith(".txt") else f"{req.chapter}.txt")
    if original_path.exists():
        with original_path.open("w", encoding="utf-8", newline="") as f:
            f.write(new_text)
        log.info(f"Overwritten file: {original_path}")
    
    # Create an .applied marker file to indicate this chapter is finished by human
    applied_marker = tasks.get_cache_path("mark", req.novel_id, req.chapter).with_suffix(".applied")
    try:
        applied_marker.touch()
    except:
        pass

    return {"text": new_text, "changes": log_entries, "saved_to": str(original_path)}

class FullAnalyzeRequest(BaseModel):
    novel_id: str
    chapter: str
    text: str
    use_cache: bool = True
    tasks: List[str] # ["mark", "chars", "events", "summary"]

@app.post("/api/analyze/full")
async def api_full_analysis(req: FullAnalyzeRequest):
    results = {}
    tasks_to_run = req.tasks
    
    async def run_task(t):
        if t == "mark": results["mark"] = await tasks.run_mark_errors(req.novel_id, req.chapter, req.text, req.use_cache)
        elif t == "chars": 
            res = await tasks.run_extract_characters(req.novel_id, req.chapter, req.text, req.use_cache)
            if isinstance(res, list):
                for char in res:
                    rag.add_character(req.novel_id, char)
            results["chars"] = res
        elif t == "events": 
            evs = await tasks.run_extract_events(req.novel_id, req.chapter, req.text, req.use_cache)
            results["events"] = evs
            results["timeline"] = await tasks.run_build_timeline(req.novel_id, evs)
        elif t == "summary": 
            results["summary"] = await tasks.run_extract_summary(req.novel_id, req.chapter, [req.text[:3000]], req.use_cache)

    if USE_LOCAL_VLLM:
        await asyncio.gather(*(run_task(t) for t in tasks_to_run))
    else:
        # Sequential for API to avoid rate limits / concurrency issues
        for t in tasks_to_run:
            await run_task(t)
            
    return results

@app.post("/api/analyze/characters")
async def api_extract_characters(req: AnalyzeRequest):
    result = await tasks.run_extract_characters(req.novel_id, req.chapter, req.text, req.use_cache)
    if isinstance(result, list):
        for char in result:
            rag.add_character(req.novel_id, char)
    return {"characters": result}

@app.post("/api/analyze/events")
async def api_extract_events(req: AnalyzeRequest):
    result = await tasks.run_extract_events(req.novel_id, req.chapter, req.text, req.use_cache)
    return {"events": result}

@app.post("/api/analyze/timeline")
async def api_build_timeline(req: TimelineRequest):
    result = await tasks.run_build_timeline(req.novel_id, req.events)
    return {"timeline": result}

@app.post("/api/analyze/summary")
async def api_extract_summary(req: SummaryRequest):
    # Use chapter if available, otherwise 'global'
    chapter = req.chapter if hasattr(req, 'chapter') and req.chapter else "global"
    result = await tasks.run_extract_summary(req.novel_id, chapter, req.chunks, True)
    return {"summary": result}

@app.post("/api/export/assistant")
async def api_export_to_assistant(req: ExportRequest):
    path = tasks.export_to_assistant(req.novel_id, req.data)
    return {"path": str(path), "success": True}

@app.get("/api/names")
async def get_name_dict():
    if NAMES_DICT_PATH.exists():
        return json.loads(NAMES_DICT_PATH.read_text("utf-8"))
    return {}

@app.get("/api/results/{novel_id}")
async def get_results(novel_id: str):
    p = RESULTS_DIR / f"{novel_id}.json"
    if not p.exists():
        return {}
    try:
        content = p.read_text("utf-8").strip()
        if not content:
            return {}
        return json.loads(content)
    except Exception as e:
        log.error(f"Error reading results for {novel_id}: {e}")
        return {}

@app.post("/api/results/{novel_id}")
async def save_results(novel_id: str, data: dict):
    p = RESULTS_DIR / f"{novel_id}.json"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    return {"saved": True}

@app.get("/api/logs/{novel_id}")
async def get_logs(novel_id: str):
    iss_p = LOGS_DIR / f"{novel_id}_issues.jsonl"
    cor_p = LOGS_DIR / f"{novel_id}_corrections.jsonl"
    iss, cor = [], []
    for p, l in [(iss_p, iss), (cor_p, cor)]:
        if p.exists():
            for line in p.read_text("utf-8").splitlines():
                try: l.append(json.loads(line))
                except: pass
    return {"issues": iss, "corrections": cor}

# ── Serve frontend ──────────────────────────────────────────────────────────────
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# Mount frontend at root to avoid 404 on siblings (style.css, app.js)
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7788, reload=False)
