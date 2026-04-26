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
import local_checker

log = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────────────────────────────────

def get_cache_path(category: str, novel_id: str, chapter: str) -> Path:
    """Returns a structured path: data/cache/{novel_id}/{chapter}.{category}.json"""
    # Sanitize chapter name just in case
    safe_chapter = re.sub(r'[\\/:*?"<>|]', '_', chapter)
    folder = CACHE_DIR / novel_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{safe_chapter}.{category}.json"

def calculate_text_hash(text: str) -> str:
    """Stable hash for text content validation."""
    norm_text = text.replace('\r\n', '\n').strip()
    return hashlib.sha256(norm_text.encode()).hexdigest()[:16]

def load_cache(category: str, novel_id: str, chapter: str, text: str) -> dict | list | None:
    p = get_cache_path(category, novel_id, chapter)
    if p.exists():
        try:
            data = json.loads(p.read_text("utf-8"))
            if not data: return None
            
            # Verify text hash to ensure cache is still valid for this version of the text
            current_hash = calculate_text_hash(text)
            saved_hash = data.get("_text_hash") if isinstance(data, dict) else None
            
            # For 'global' entries (novel-wide analysis), we skip the hash check 
            # as it was likely generated from a different chapter's text.
            if chapter == "global":
                pass
            elif isinstance(data, dict) and saved_hash and saved_hash != current_hash:
                return None # Stale
            
            # Handle list-based results (like characters)
            actual_data = data.get("data") if (isinstance(data, dict) and "data" in data) else data

            if isinstance(actual_data, dict):
                if "raw_error" in actual_data: return None
                if category == "mark" and "issues" not in actual_data: return None
            
            # Auto-fix offsets for mark errors
            if category == "mark" and isinstance(actual_data, dict) and "issues" in actual_data:
                fixed_issues, warnings = _fix_offsets(text, actual_data["issues"])
                actual_data["issues"] = fixed_issues
                if warnings:
                    actual_data["warnings"] = warnings
            
            return actual_data
        except Exception:
            pass
    return None

def save_cache(category: str, novel_id: str, chapter: str, text: str, data: dict | list) -> None:
    try:
        p = get_cache_path(category, novel_id, chapter)
        # Wrap with hash for validation
        wrapper = {
            "_text_hash": calculate_text_hash(text),
            "data": data,
            "novel": novel_id,
            "chapter": chapter,
            "type": category
        }
        p.write_text(json.dumps(wrapper, ensure_ascii=False, indent=2), "utf-8")
        log.debug(f"Saved cache: {p}")
    except Exception as e:
        log.error(f"Failed to save cache for {novel_id}/{chapter}: {e}")


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
    
    # Pre-compiled tag/space pattern
    TAG_SEP = r"\s*(?:<[^>]+>|&nbsp;|&emsp;)*\s*"
    
    for issue in issues:
        orig = issue.get("original")
        context = issue.get("context", "")
        if not orig: continue

        matched = False
        if context:
            # Create a lenient regex pattern from context
            # We allow tags/spaces between any character in the context
            # To avoid regex performance issues, we only do this for characters near the 'orig' part
            # or just escape the whole thing but allow tags between words.
            
            # Escape each char and join with optional tag separator
            # Only do character-level lenient for short-to-medium contexts to avoid explosion
            if len(context) < 100:
                pattern = TAG_SEP.join([re.escape(c) for c in context])
            else:
                pattern = re.escape(context).replace(r"\ ", TAG_SEP)

            try:
                # Use DOTALL so . matches newlines if any
                match = re.search(pattern, text, re.DOTALL)
                if match:
                    match_text = match.group(0)
                    match_start = match.start()
                    
                    # Map characters in match_text to their original indices (ignoring tags)
                    clean_match = ""
                    mapping = [] # mapping[clean_idx] = original_idx_in_match_text
                    
                    i = 0
                    while i < len(match_text):
                        if match_text[i] == '<':
                            end_tag = match_text.find('>', i)
                            if end_tag != -1:
                                i = end_tag + 1
                                continue
                        if match_text.startswith('&nbsp;', i):
                            i += 6
                            continue
                        if match_text.startswith('&emsp;', i):
                            i += 6
                            continue
                        
                        clean_match += match_text[i]
                        mapping.append(i)
                        i += 1
                    
                    # Try to find 'orig' in clean_match (logical text)
                    c_idx = clean_match.find(orig)
                    
                    # If not found (due to S2T mismatch), use position in the 'context' string
                    # Since clean_match corresponds to the context
                    if c_idx == -1 and orig in context:
                        c_idx = context.find(orig)
                    
                    if c_idx != -1 and c_idx < len(mapping):
                        start_in_match = mapping[c_idx]
                        # Find end index based on character length
                        end_clean_idx = min(c_idx + len(orig) - 1, len(mapping) - 1)
                        end_in_match = mapping[end_clean_idx] + 1
                        
                        found_orig = match_text[start_in_match:end_in_match]
                        
                        new_issue = issue.copy()
                        new_issue["original"] = found_orig
                        new_issue["start"] = match_start + start_in_match
                        new_issue["end"] = match_start + end_in_match
                        fixed.append(new_issue)
                        matched = True
            except Exception as e:
                log.debug(f"Regex match failed: {e}")

        if not matched:
            # Fallback: exact match in full text
            idx = text.find(orig)
            if idx != -1:
                new_issue = issue.copy()
                new_issue["start"] = idx
                new_issue["end"] = idx + len(orig)
                fixed.append(new_issue)
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
    if use_cache:
        cached = load_cache("mark", novel_id, chapter, text)
        if cached is not None:
            log.info("Cache hit for mark_errors %s/%s", novel_id, chapter)
            return cached

    rag_ctx = rag.build_rag_context(novel_id, "mark", text[:500])
    messages = mark_errors_prompt(text, rag_ctx)

    # RUN LOCAL CHECKS FIRST
    local_issues = local_checker.run_local_checks(text)
    
    raw = await chat(messages, max_tokens=MAX_TOKENS_MARK)
    
    if raw.startswith("錯誤："):
        return {"issues": local_issues, "error": raw}

    try:
        result = _parse_json(raw)
        llm_issues = []
        if isinstance(result, dict) and "issues" in result:
            llm_issues, warnings = _fix_offsets(text, result["issues"])
            if warnings:
                result["warnings"] = warnings
        
        # Merge local and LLM issues
        # Simple deduplication: if they overlap, prefer LLM for now as it's smarter,
        # but keep local ones for pure SC/TC conversion.
        merged_issues = local_issues.copy()
        
        # Avoid adding LLM issues that exactly match local ones' range
        local_ranges = set((iss["start"], iss["end"]) for iss in local_issues)
        for iss in llm_issues:
            if (iss["start"], iss["end"]) not in local_ranges:
                merged_issues.append(iss)
        
        # Re-sort and re-ID
        merged_issues.sort(key=lambda x: x["start"])
        for idx, iss in enumerate(merged_issues):
            iss["id"] = f"M{idx+1:03d}"
            
        result["issues"] = merged_issues
            
        # Always save to cache if analysis succeeded, regardless of use_cache (which only controls loading)
        save_cache("mark", novel_id, chapter, text, result)
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
    chapter: str,
    text: str,
    use_cache: bool = True,
) -> list:
    if use_cache:
        cached = load_cache("chars", novel_id, chapter, text)
        if cached is not None:
            return cached

    # Hybrid RAG: Index all names, but only provide descriptions for characters in the current text
    existing_list = []
    res_path = RESULTS_DIR / f"{novel_id}.json"
    if res_path.exists():
        try:
            data = json.loads(res_path.read_text("utf-8"))
            for c in data.get("characters", []):
                name = c.get("角色名稱")
                aliases = c.get("別名", [])
                
                # Check if this character appears in current text
                is_present = (name in text) or any(a in text for a in aliases)
                
                if is_present:
                    # Provide full info to maintain consistency
                    desc = c.get("角色描述", "暫無描述")
                    existing_list.append(f"● {name} (別名: {', '.join(aliases)}) - 已有描述: {desc}")
                else:
                    # Just name to prevent duplicates
                    existing_list.append(f"● {name} (別名: {', '.join(aliases)})")
        except:
            pass
    
    rag_ctx = "【已知角色參考字典】：\n" + "\n".join(existing_list) if existing_list else ""
    messages = extract_characters_prompt(text, rag_ctx)
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    if raw.startswith("錯誤："):
        return []

    try:
        result = _parse_json(raw)
        if isinstance(result, list) and result:
            for char in result:
                rag.add_character(novel_id, char)
            # Always save to cache using the correct chapter name
            save_cache("chars", novel_id, chapter, text, result)
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
    if use_cache:
        cached = load_cache("events", novel_id, chapter, text)
        if cached is not None:
            return cached

    # Use a smaller window for event context to prevent AI from summarizing too much history
    rag_ctx = rag.build_rag_context(novel_id, "event", text[:2000])
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
            # Always save to cache
            save_cache("events", novel_id, chapter, text, result)
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

async def run_extract_summary(novel_id: str, chapter: str, text_chunks: list[str], use_cache: bool = True) -> str:
    # Use the combined text as the basis for the cache key
    combined_text = "".join(text_chunks)
    if use_cache:
        cached = load_cache("summary", novel_id, chapter, combined_text)
        if cached: return cached

    messages = story_summary_prompt(text_chunks)
    raw = await chat(messages, max_tokens=2048)
    res = raw.strip()
    
    # Always save to cache using the correct chapter name
    save_cache("summary", novel_id, chapter, combined_text, res)
    return res


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
