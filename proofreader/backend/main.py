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

import tasks
from config import RESULTS_DIR, NAMES_DICT_PATH, NOVEL_NAMES_PATH, LOGS_DIR

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
    chapter: str = ""
    chunks: List[str]
    use_cache: bool = True

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
    
    c = tasks.load_cache("chars", req.novel_id, req.chapter, req.text)
    if c: res["chars"] = c
    
    e = tasks.load_cache("events", req.novel_id, req.chapter, req.text)
    if e: res["events"] = e
    
    # Summary is novel-level (aggregated in results.json). Prefer that to avoid
    # overwriting the global summary with a single-chapter cache.
    novel_res = tasks.load_novel_results(req.novel_id)
    novel_summary = (novel_res.get("summary") or "").strip()
    if novel_summary:
        res["summary"] = novel_summary
    else:
        s = tasks.load_cache("summary", req.novel_id, req.chapter, req.text)
        if s:
            res["summary"] = f"### {req.chapter}\n{s}"
    
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

    allowed_tasks = {"mark", "chars", "events", "summary"}
    requested_tasks = [t for t in (req.tasks or []) if t in allowed_tasks]
    if not requested_tasks:
        requested_tasks = ["mark"]

    # Get all .txt files except table.txt
    files = [f for f in novel_dir.glob("*.txt") if f.name.lower() != "table.txt"]
    files = sorted(files, key=lambda x: [int(c) if c.isdigit() else c for c in re.split(r'(\d+)', x.name)])
    batch_status[novel_id] = _create_batch_status(len(files))
    
    async def process_all():
        for i, f_path in enumerate(files):
            if novel_id in stop_requested:
                log.info(f"Stop requested for {novel_id}, terminating batch scan.")
                batch_status[novel_id]["status"] = "stopped"
                stop_requested.remove(novel_id)
                return # Exit immediately
                
            try:
                content = _read_file_content(f_path)
                chapter_name = f_path.name
                
                # 1. Check for skips if use_cache is on
                if req.use_cache:
                    # If all requested tasks have a VALID cache, skip this file entirely.
                    cached_mark = None
                    cached_chars = None
                    cached_events = None
                    cached_summary = None

                    if "mark" in requested_tasks:
                        cached_mark = tasks.load_cache("mark", novel_id, chapter_name, content)
                    if "chars" in requested_tasks:
                        cached_chars = tasks.load_cache("chars", novel_id, chapter_name, content)
                    if "events" in requested_tasks:
                        cached_events = tasks.load_cache("events", novel_id, chapter_name, content)
                    if "summary" in requested_tasks:
                        cached_summary = tasks.load_cache("summary", novel_id, chapter_name, content)

                    cache_complete = True
                    for t in requested_tasks:
                        if t == "mark" and cached_mark is None:
                            cache_complete = False
                        elif t == "chars" and cached_chars is None:
                            cache_complete = False
                        elif t == "events" and cached_events is None:
                            cache_complete = False
                        elif t == "summary" and cached_summary is None:
                            cache_complete = False

                    if cache_complete:
                        # Even if skipped, we still merge cached outputs into novel-level results
                        # so results.json can be (re)constructed without re-running LLM calls.
                        chapter_summaries = (
                            [(chapter_name, cached_summary)]
                            if isinstance(cached_summary, str) and cached_summary.strip()
                            else None
                        )
                        if (isinstance(cached_chars, list) and cached_chars) or (isinstance(cached_events, list) and cached_events) or chapter_summaries:
                            tasks.update_novel_results(
                                novel_id,
                                characters=cached_chars if isinstance(cached_chars, list) else None,
                                chapter_summaries=chapter_summaries,
                                events=cached_events if isinstance(cached_events, list) else None,
                            )
                        
                        batch_status[novel_id]["current"] = i + 1
                        batch_status[novel_id]["last_chapter"] = chapter_name
                        continue

                # 2. Execute requested tasks (only if not skipped)
                task_map = {}
                if "mark" in requested_tasks:
                    task_map["mark"] = tasks.run_mark_errors(novel_id, chapter_name, content, use_cache=req.use_cache)
                if "chars" in requested_tasks:
                    task_map["chars"] = tasks.run_extract_characters(novel_id, chapter_name, content, use_cache=req.use_cache)
                if "events" in requested_tasks:
                    task_map["events"] = tasks.run_extract_events(novel_id, chapter_name, content, use_cache=req.use_cache)
                if "summary" in requested_tasks:
                    task_map["summary"] = tasks.run_extract_summary(novel_id, chapter_name, content, use_cache=req.use_cache)

                outputs = await asyncio.gather(*task_map.values(), return_exceptions=True)
                results_map = dict(zip(task_map.keys(), outputs))

                had_error = False
                for k, v in list(results_map.items()):
                    if isinstance(v, Exception):
                        had_error = True
                        log.error(f"Scan task error ({chapter_name}) [{k}]: {v}")
                        results_map[k] = None

                c_list = results_map.get("chars") if isinstance(results_map.get("chars"), list) else None
                evs = results_map.get("events") if isinstance(results_map.get("events"), list) else None
                s = results_map.get("summary") if isinstance(results_map.get("summary"), str) else None

                chapter_summaries = [(chapter_name, s)] if s else None
                if c_list or evs or chapter_summaries:
                    tasks.update_novel_results(
                        novel_id,
                        characters=c_list,
                        chapter_summaries=chapter_summaries,
                        events=evs,
                    )

                batch_status[novel_id]["current"] = i + 1
                batch_status[novel_id]["last_chapter"] = chapter_name
                if had_error:
                    batch_status[novel_id]["failed"] += 1
                    batch_status[novel_id]["failed_files"].append(chapter_name)

            except Exception as e:
                log.error(f"Scan batch error for {f_path.name}: {e}")
                batch_status[novel_id]["failed"] += 1
                batch_status[novel_id]["failed_files"].append(f_path.name)
                batch_status[novel_id]["current"] = i + 1
        
        batch_status[novel_id]["status"] = "done"

    background_tasks.add_task(process_all)
    return {"message": "Scan started", "total": len(files)}

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
    results: dict = {}
    allowed_tasks = {"mark", "chars", "events", "summary"}
    tasks_to_run = [t for t in (req.tasks or []) if t in allowed_tasks]
    chapter_summary: Optional[str] = None

    async def run_task(t):
        nonlocal chapter_summary
        if t == "mark":
            results["mark"] = await tasks.run_mark_errors(req.novel_id, req.chapter, req.text, req.use_cache)
        elif t == "chars":
            results["chars"] = await tasks.run_extract_characters(req.novel_id, req.chapter, req.text, req.use_cache)
        elif t == "events":
            results["events"] = await tasks.run_extract_events(req.novel_id, req.chapter, req.text, req.use_cache)
        elif t == "summary":
            chapter_summary = await tasks.run_extract_summary(req.novel_id, req.chapter, req.text, req.use_cache)

    # Run tasks concurrently (LLM concurrency is controlled in llm_client).
    await asyncio.gather(*(run_task(t) for t in tasks_to_run))

    # Chapter-level outputs (raw from this chapter's analysis)
    chars_out = results.get("chars") if isinstance(results.get("chars"), list) else []
    events_out = results.get("events") if isinstance(results.get("events"), list) else []
    summaries_out = [(req.chapter, chapter_summary)] if (isinstance(chapter_summary, str) and chapter_summary.strip()) else None

    # Merge into novel-level results.json
    if chars_out or events_out or summaries_out:
        tasks.update_novel_results(
            req.novel_id,
            characters=chars_out or None,
            chapter_summaries=summaries_out,
            events=events_out or None,
        )

    # Load freshest novel-level data for aggregate fields
    novel_res = tasks.load_novel_results(req.novel_id)

    # Build response: always include chapter-level data + aggregate fields
    if "chars" in tasks_to_run:
        results["chars"] = chars_out  # This chapter's characters
    if "events" in tasks_to_run:
        results["events"] = events_out  # This chapter's events
        results["timeline"] = novel_res.get("timeline", [])  # Full novel timeline
    if "summary" in tasks_to_run:
        results["summary"] = chapter_summary or ""  # This chapter's summary

    # Novel-level aggregate fields (always returned if analysis ran)
    results["aggregate_summary"] = novel_res.get("aggregate_summary", novel_res.get("summary", ""))
    results["aggregate_characters"] = novel_res.get("aggregate_characters", novel_res.get("characters", []))
    results["aggregate_timeline"] = novel_res.get("timeline", [])

    return results

@app.post("/api/analyze/characters")
async def api_extract_characters(req: AnalyzeRequest):
    result = await tasks.run_extract_characters(req.novel_id, req.chapter, req.text, req.use_cache)
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
    chapter = req.chapter or "global"
    result = await tasks.run_extract_summary(req.novel_id, chapter, req.chunks, req.use_cache)
    return {"summary": result}

@app.post("/api/export/assistant")
async def api_export_to_assistant(req: ExportRequest):
    # Export always uses the global novel-level results (ignores req.data)
    path = tasks.export_to_assistant(req.novel_id)
    return {"path": str(path), "success": True}


@app.post("/api/analyze/consolidate")
async def api_consolidate_summary(novel_id: str):
    """Trigger LLM-based consolidation of all chapter summaries into a single novel summary."""
    agg = await tasks.run_consolidate_novel_summary(novel_id)
    return {"aggregate_summary": agg}

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
