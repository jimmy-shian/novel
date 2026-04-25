"""
Core LLM task runners – error marking, character/event analysis, etc.
Each function handles: RAG context build → prompt → LLM call → JSON parse → cache.
"""
import json
import hashlib
import logging
import re
from pathlib import Path

from config import (
    MAX_TOKENS_MARK, MAX_TOKENS_ANALYSIS, CACHE_DIR, NAMES_DICT_PATH,
    LOGS_DIR
)
from llm_client import chat
from prompts import (
    mark_errors_prompt, extract_characters_prompt,
    extract_events_prompt, build_timeline_prompt,
    normalize_names_prompt, story_summary_prompt
)
import rag

log = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────────────────────────────────

def get_cache_tag(category: str, novel_id: str, chapter: str) -> str:
    return f"{category}:{novel_id}:{chapter}"


def cache_key(tag: str, text: str) -> str:
    return hashlib.sha256(f"{tag}:{text}".encode()).hexdigest()[:16]


def load_cache(tag: str, text: str) -> dict | list | None:
    p = CACHE_DIR / f"{cache_key(tag, text)}.json"
    if p.exists():
        try:
            data = json.loads(p.read_text("utf-8"))
            if not data: return None
            if isinstance(data, dict):
                if "raw_error" in data: return None
                if tag.startswith("mark:") and "issues" not in data: return None
            
            # Auto-fix offsets for older cache files or AI failures
            if tag.startswith("mark:") and isinstance(data, dict) and "issues" in data:
                fixed_issues, warnings = _fix_offsets(text, data["issues"])
                data["issues"] = fixed_issues
                if warnings:
                    data["warnings"] = warnings
            
            return data
        except Exception:
            pass
    return None


def save_cache(tag: str, text: str, data: dict | list) -> None:
    p = CACHE_DIR / f"{cache_key(tag, text)}.json"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def _parse_json(raw: str) -> dict | list:
    """Extract JSON from LLM response (handles markdown fences)."""
    raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw.strip())
    raw = re.sub(r"\n?```$", "", raw.strip())
    return json.loads(raw)


def _load_name_dict() -> dict:
    if NAMES_DICT_PATH.exists():
        try:
            return json.loads(NAMES_DICT_PATH.read_text("utf-8"))
        except Exception:
            pass
    return {}


def _save_name_dict(d: dict) -> None:
    NAMES_DICT_PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), "utf-8")


def _fix_offsets(text: str, issues: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Finds the correct start/end offsets for issues.
    Uses regex for robust context matching (ignoring extra spaces/tags).
    Returns fixed issue list and warnings for any unmatched original terms.
    """
    fixed = []
    warnings = []
    for issue in issues:
        orig = issue.get("original")
        context = issue.get("context", "")
        if not orig:
            continue

        matched = False
        if context and orig in context:
            escaped_context = re.escape(context)
            pattern = escaped_context.replace(r"\ ", r"\s*(?:<[^>]+>|&nbsp;|&emsp;)*\s*")
            try:
                match = re.search(pattern, text)
                if match:
                    match_text = match.group(0)
                    match_start = match.start()
                    inner_idx = match_text.find(orig)
                    if inner_idx != -1:
                        start = match_start + inner_idx
                        end = start + len(orig)
                        new_issue = issue.copy()
                        new_issue["start"] = start
                        new_issue["end"] = end
                        fixed.append(new_issue)
                        matched = True
            except Exception as e:
                log.debug(f"Regex match failed: {e}")

        if not matched:
            start_search = 0
            while True:
                idx = text.find(orig, start_search)
                if idx == -1:
                    break
                if len(orig) < 2 and not context:
                    break
                new_issue = issue.copy()
                new_issue["start"] = idx
                new_issue["end"] = idx + len(orig)
                fixed.append(new_issue)
                start_search = idx + len(orig)
                matched = True

        if not matched:
            log.warning(f"Could not locate '{orig}' in text (Context: {context})")
            warnings.append({
                "original": orig,
                "context": context,
                "message": f"無法定位原文：{orig}",
            })

    return fixed, warnings


def _log_issues(novel_id: str, chapter: str, issues: list) -> None:
    log_file = LOGS_DIR / f"{novel_id}_issues.jsonl"
    with log_file.open("a", encoding="utf-8") as f:
        for issue in issues:
            f.write(json.dumps({"novel": novel_id, "chapter": chapter, **issue},
                                ensure_ascii=False) + "\n")


# ── 1. Error marking ────────────────────────────────────────────────────────────

async def run_mark_errors(
    novel_id: str,
    chapter: str,
    text: str,
    use_cache: bool = True,
) -> dict:
    cache_tag = f"mark:{novel_id}:{chapter}"
    if use_cache:
        cached = load_cache(cache_tag, text)
        if cached is not None:
            log.info("Cache hit for mark_errors %s/%s", novel_id, chapter)
            return cached

    rag_ctx = rag.build_rag_context(novel_id, "mark", text[:500])
    messages = mark_errors_prompt(text, rag_ctx)

    raw = await chat(messages, max_tokens=MAX_TOKENS_MARK)
    
    if raw.startswith("錯誤："):
        return {"issues": [], "error": raw}

    try:
        result = _parse_json(raw)
        if isinstance(result, dict) and "issues" in result:
            fixed_issues, warnings = _fix_offsets(text, result["issues"])
            result["issues"] = fixed_issues
            if warnings:
                result["warnings"] = warnings
            
        if use_cache:
            save_cache(cache_tag, text, result)
    except Exception as e:
        log.error("JSON parse failed for mark_errors: %s", e)
        result = {"issues": [], "raw_error": str(e), "raw_response": raw}

    if isinstance(result, dict) and "issues" in result:
        _log_issues(novel_id, chapter, result["issues"])

    return result


# ── 2. Apply corrections ───────────────────────────────────────────────────────

def apply_corrections(
    text: str,
    decisions: list[dict],
    novel_id: str,
    chapter: str,
) -> tuple[str, list[dict]]:
    # Sort by start descending
    to_apply = [d for d in decisions if d.get("action") in ("accept", "manual")]
    to_apply.sort(key=lambda d: d["start"], reverse=True)

    change_log = []
    name_dict = _load_name_dict()

    for d in to_apply:
        s, e = d["start"], d["end"]
        replacement = d["manual_text"] if d.get("action") == "manual" else d["suggestion"]
        original = text[s:e]

        text = text[:s] + replacement + text[e:]
        change_log.append({
            "id": d.get("id"),
            "original": original,
            "replacement": replacement,
            "action": d.get("action"),
        })

        if d.get("type") == "人名" and original.strip():
            name_dict[original.strip()] = replacement.strip()
            rag.add_correction(novel_id, original.strip(), replacement.strip())

    if change_log:
        _save_name_dict(name_dict)
        log_file = LOGS_DIR / f"{novel_id}_corrections.jsonl"
        with log_file.open("a", encoding="utf-8") as f:
            for entry in change_log:
                f.write(json.dumps({"novel": novel_id, "chapter": chapter, **entry},
                                    ensure_ascii=False) + "\n")

    return text, change_log


# ── 3. Character extraction ─────────────────────────────────────────────────────

async def run_extract_characters(
    novel_id: str,
    text: str,
    use_cache: bool = True,
) -> list:
    cache_tag = get_cache_tag("chars", novel_id, "global")
    if use_cache:
        cached = load_cache(cache_tag, text)
        if cached is not None:
            return cached

    rag_ctx = rag.build_rag_context(novel_id, "character", text[:500])
    messages = extract_characters_prompt(text, rag_ctx)
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    if raw.startswith("錯誤："):
        return []

    try:
        result = _parse_json(raw)
        if isinstance(result, list) and result:
            for char in result:
                rag.add_character(novel_id, char)
            if use_cache:
                save_cache(cache_tag, text, result)
        else:
            result = []
    except Exception:
        result = []

    return result


# ── 4. Plot event extraction ────────────────────────────────────────────────────

async def run_extract_events(
    novel_id: str,
    chapter: str,
    text: str,
    use_cache: bool = True,
) -> list:
    cache_tag = get_cache_tag("events", novel_id, chapter)
    if use_cache:
        cached = load_cache(cache_tag, text)
        if cached is not None:
            return cached

    rag_ctx = rag.build_rag_context(novel_id, "plot", text[:500])
    messages = extract_events_prompt(text, chapter, rag_ctx)
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    if raw.startswith("錯誤："):
        return []

    try:
        result = _parse_json(raw)
        if isinstance(result, list) and result:
            for ev in result:
                ev["章節"] = ev.get("章節") or chapter
                rag.add_event(novel_id, ev)
            if use_cache:
                save_cache(cache_tag, text, result)
        else:
            result = []
    except Exception:
        result = []

    return result


# ── 5. Timeline consolidation ────────────────────────────────────────────────────

async def run_build_timeline(novel_id: str, all_events: list) -> list:
    events_json = json.dumps(all_events, ensure_ascii=False, indent=2)
    messages = build_timeline_prompt(events_json)
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    try:
        return _parse_json(raw)
    except Exception:
        return []


# ── 6. Story Summary ────────────────────────────────────────────────────────────

async def run_extract_summary(novel_id: str, text_chunks: list[str]) -> str:
    messages = story_summary_prompt(text_chunks)
    raw = await chat(messages, max_tokens=2048)
    return raw.strip()


# ── 7. Export to Assistant ───────────────────────────────────────────────────────

def export_to_assistant(novel_id: str, results_data: dict):
    """
    Format results into Assistant JSON format and save to assistant/data.
    Aligns with overlay.js character bubble and sidebar requirements.
    """
    assistant_data_dir = Path(__file__).parent.parent.parent / "assistant" / "data"
    assistant_data_dir.mkdir(parents=True, exist_ok=True)

    ai_chars = results_data.get("characters", [])
    formatted_chars = []
    
    for i, c in enumerate(ai_chars):
        char_name = c.get("角色名稱", "")
        formatted_chars.append({
            "id": i + 1,
            "name": char_name,
            "gender": c.get("性別", "未知"),
            "faction": c.get("身份", "散人"),
            "power": ", ".join(c.get("能力", [])) if isinstance(c.get("能力"), list) else c.get("能力", ""),
            "status": "存活",
            "description": c.get("角色描述", ""),
            "appearances": []
        })
    
    # Process Appearances from Events
    events = results_data.get("events", [])
    for ev in events:
        involved = ev.get("涉及角色", [])
        ch_title = ev.get("章節", "未知章節")
        # Try to find a number in chapter title
        num_match = re.search(r"(\d+)", ch_title)
        ch_num = int(num_match.group(1)) if num_match else 1
        
        event_desc = ev.get("事件描述", "")
        
        for name in involved:
            target = next((fc for fc in formatted_chars if fc["name"] == name), None)
            if target:
                # Avoid duplicate appearances for same chapter
                if not any(a["chapterTitle"] == ch_title for a in target["appearances"]):
                    target["appearances"].append({
                        "chapterNum": ch_num,
                        "chapterTitle": ch_title,
                        "event": event_desc,
                        "url": ""
                    })

    final_data = {
        "novel": results_data.get("novel_id", novel_id),
        "folder": novel_id,
        "characters": formatted_chars,
        "summary": results_data.get("summary", ""),
        "timeline": results_data.get("timeline", [])
    }

    out_path = assistant_data_dir / f"{novel_id}.json"
    out_path.write_text(json.dumps(final_data, ensure_ascii=False, indent=2), "utf-8")
    return str(out_path)


# ── 8. Name normalization ────────────────────────────────────────────────────────

async def run_normalize_names(novel_id: str, text: str) -> dict:
    name_dict = _load_name_dict()
    messages = normalize_names_prompt(text, name_dict)
    raw = await chat(messages, max_tokens=1024)
    try:
        result = _parse_json(raw)
        return result.get("name_map", {})
    except Exception:
        return {}
