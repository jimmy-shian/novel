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
from typing import Dict, List, Optional
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

# ── Pydantic models ─────────────────────────────────────────────────────────────

class MarkRequest(BaseModel):
    novel_id: str
    chapter: str
    text: str
    use_cache: bool = True

class BatchMarkRequest(BaseModel):
    novel_id: str
    files: List[dict] # {filename, content, chapter}

class BatchScanRequest(BaseModel):
    novel_id: str
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
                    item["cache"] = {
                        "mark": tasks.get_cache_path("mark", novel_path, entry.name).exists(),
                        "events": tasks.get_cache_path("events", novel_path, entry.name).exists(),
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
            # Check if user requested to stop
            if batch_status.get(novel_id, {}).get("status") == "stopped":
                log.info(f"Stopping batch scan for {novel_id}")
                return

            try:
                content = f_path.read_text("utf-8", errors="ignore")
                
                # Execute requested tasks
                if "mark" in req.tasks:
                    await tasks.run_mark_errors(novel_id, f_path.name, content, use_cache=True)
                
                if "chars" in req.tasks:
                    c_list = await tasks.run_extract_characters(novel_id, content, use_cache=True)
                    if c_list: all_chars.extend(c_list)
                
                if "events" in req.tasks:
                    evs = await tasks.run_extract_events(novel_id, f_path.name, content, use_cache=True)
                    if evs: all_events.extend(evs)
                
                if "summary" in req.tasks:
                    # Only summarize first/middle/last if too many? 
                    # For batch, maybe just first 3 chapters or so
                    if i < 5:
                        s = await tasks.run_extract_summary(novel_id, [content[:3000]], use_cache=True)
                        if s: all_summaries.append(s)

                batch_status[novel_id]["current"] = i + 1
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

@app.post("/api/batch/stop/{novel_id}")
async def api_batch_stop(novel_id: str):
    if novel_id in batch_status:
        batch_status[novel_id]["status"] = "stopped"
        return {"success": True}
    return {"success": False, "message": "Not running"}

def _update_novel_results_from_batch(novel_id, chars, summaries, timeline):
    res_path = RESULTS_DIR / f"{novel_id}.json"
    data = {"characters": [], "summary": "", "timeline": [], "novel": novel_id}
    if res_path.exists():
        try: data = json.loads(res_path.read_text("utf-8"))
        except: pass
        
    if chars:
        # Deduplicate and merge characters
        existing = {c.get('角色名稱'): c for c in data.get("characters", []) if c.get('角色名稱')}
        for c in chars:
            name = c.get("角色名稱")
            if not name: continue
            if name not in existing:
                existing[name] = c
            else:
                # Merge description if missing
                if not existing[name].get("角色描述") and c.get("角色描述"):
                    existing[name]["角色描述"] = c["角色描述"]
        data["characters"] = list(existing.values())
        
    if summaries and not data.get("summary"):
        # Just use the first one found or join them
        data["summary"] = summaries[0]
    
    if timeline:
        data["timeline"] = timeline
    
    res_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")

@app.post("/api/batch/mark")
async def api_batch_mark(req: BatchMarkRequest, background_tasks: BackgroundTasks):
    novel_id = req.novel_id
    batch_status[novel_id] = _create_batch_status(len(req.files))
    
    async def process_batch():
        for i, f in enumerate(req.files):
            try:
                await tasks.run_mark_errors(novel_id, f["chapter"], f["content"], use_cache=True)
                batch_status[novel_id]["current"] = i + 1
            except Exception as e:
                log.error(f"Batch process error for {f['filename']}: {e}")
                batch_status[novel_id]["failed"] += 1
                batch_status[novel_id]["failed_files"].append(f["filename"])
                batch_status[novel_id]["current"] = i + 1
        batch_status[novel_id]["status"] = "done"

    background_tasks.add_task(process_batch)
    return {"message": "Batch started", "total": len(req.files)}

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
    
    return {"text": new_text, "changes": log_entries, "saved_to": str(original_path)}

class FullAnalyzeRequest(BaseModel):
    novel_id: str
    chapter: str
    text: str
    tasks: List[str] # ["mark", "chars", "events", "summary"]

@app.post("/api/analyze/full")
async def api_full_analysis(req: FullAnalyzeRequest):
    results = {}
    tasks_to_run = req.tasks
    
    async def run_task(t):
        if t == "mark": results["mark"] = await tasks.run_mark_errors(req.novel_id, req.chapter, req.text)
        elif t == "chars": results["chars"] = await tasks.run_extract_characters(req.novel_id, req.text)
        elif t == "events": 
            evs = await tasks.run_extract_events(req.novel_id, req.chapter, req.text)
            results["events"] = evs
            results["timeline"] = await tasks.run_build_timeline(req.novel_id, evs)
        elif t == "summary": 
            results["summary"] = await tasks.run_extract_summary(req.novel_id, [req.text[:3000]])

    if USE_LOCAL_VLLM:
        await asyncio.gather(*(run_task(t) for t in tasks_to_run))
    else:
        # Sequential for API to avoid rate limits / concurrency issues
        for t in tasks_to_run:
            await run_task(t)
            
    return results

@app.post("/api/analyze/characters")
async def api_extract_characters(req: AnalyzeRequest):
    result = await tasks.run_extract_characters(req.novel_id, req.text, req.use_cache)
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
    result = await tasks.run_extract_summary(req.novel_id, req.chunks)
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
    return json.loads(p.read_text("utf-8")) if p.exists() else {}

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
