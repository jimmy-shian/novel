"""
Core LLM task runners – error marking, character/event analysis, etc.
Each function handles: RAG context build → prompt → LLM call → JSON parse → cache.
"""
import json
import hashlib
import logging
import re
import asyncio
from pathlib import Path

from config import (
    MAX_TOKENS_MARK, MAX_TOKENS_ANALYSIS, CACHE_DIR, NAMES_DICT_PATH,
    LOGS_DIR, RESULTS_DIR
)
from llm_client import chat
from prompts import (
    mark_errors_prompt, extract_characters_prompt,
    extract_events_prompt, merge_characters_prompt,
    normalize_names_prompt, story_summary_prompt,
    aggregate_summary_prompt
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
                log.info("Cache hash mismatch for %s/%s. Using existing cache with offset fixing.", novel_id, chapter)
                # We proceed anyway; for 'mark', _fix_offsets will attempt to re-locate terms.
                pass
            
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


def _chapter_sort_key(chapter_name: str) -> list:
    """Natural sort key for chapter names (e.g., 'Chapter 2' < 'Chapter 10')."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', chapter_name or "")]



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
        # 1. Check if chapter is already proofread/applied
        applied_path = get_cache_path("mark", novel_id, chapter).with_suffix(".applied")
        if applied_path.exists():
            log.info("Chapter %s already proofread (applied), skipping mark_errors.", chapter)
            return {"issues": [], "applied": True}

        # 2. Check for existing cache
        cached = load_cache("mark", novel_id, chapter, text)
        if cached is not None:
            log.info("[Hit] Mark: %s", chapter)
            return cached
        else:
            log.info("[No Found] Mark: %s", chapter)

    rag_ctx = rag.build_rag_context(novel_id, "mark", text[:500])
    messages = mark_errors_prompt(text, rag_ctx)

    # RUN LOCAL CHECKS FIRST
    local_issues = local_checker.run_local_checks(text)
    
    raw = await chat(messages, max_tokens=MAX_TOKENS_MARK)
    
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
            log.info("[Hit] Chars: %s", chapter)
            return cached
        else:
            log.info("[No Found] Chars: %s", chapter)

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

    try:
        result = _parse_json(raw)
        if isinstance(result, list):
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
        # 1. Check local chapter cache
        cached = load_cache("events", novel_id, chapter, text)
        if cached is not None:
            log.info("[Hit] Events: %s", chapter)
            return cached
        else:
            log.info("[No Found] Events: %s", chapter)
        
        # 2. Check global results (if it's already there, we can skip and back-fill cache)
        res_data = load_novel_results(novel_id)
        existing_events = [ev for ev in res_data.get("timeline", []) if ev.get("章節") == chapter]
        if existing_events:
            log.info("Found existing events for %s in global results, skipping extraction.", chapter)
            save_cache("events", novel_id, chapter, text, existing_events)
            return existing_events

    # Use a smaller window for event context to prevent AI from summarizing too much history
    # rag_ctx = rag.build_rag_context(novel_id, "event", text[:2000])
    messages = extract_events_prompt(text, chapter)
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)

    try:
        result = _parse_json(raw)
        if isinstance(result, list):
            pretty_name = None
            for ev in result:
                # Capture the LLM-provided chapter name as the 'Pretty Name' if it looks valid
                llm_ch = ev.get("章節")
                if llm_ch and chapter not in llm_ch:
                    pretty_name = llm_ch
                
                # Internal data always uses the canonical filename for sorting/keys
                ev["章節"] = chapter
                rag.add_event(novel_id, ev)
            
            # Update chapter_titles mapping in results.json
            if pretty_name:
                res_data = load_novel_results(novel_id)
                titles = res_data.get("chapter_titles", {})
                titles[chapter] = pretty_name
                res_data["chapter_titles"] = titles
                save_novel_results(novel_id, res_data)

            # Always save to cache
            save_cache("events", novel_id, chapter, text, result)
        else:
            result = []
            save_cache("events", novel_id, chapter, text, result)
    except Exception:
        result = []
    return result


async def run_rebuild_timeline_from_cache(novel_id: str) -> list:
    """
    Collects all chapter-level event caches and merges them into the novel-level timeline.
    Useful when the global results.json timeline gets out of sync or needs fresh ordering.
    """
    cache_dir = CACHE_DIR / novel_id
    all_events = []
    if cache_dir.exists():
        # Chapter caches are named like "ChapterName.txt.events.json"
        for p in cache_dir.glob("*.events.json"):
            try:
                raw_data = json.loads(p.read_text("utf-8"))
                # Handle both wrapped { "data": [...] } and raw [...] formats
                events_list = raw_data.get("data") if isinstance(raw_data, dict) else raw_data
                
                if isinstance(events_list, list):
                    # Canonicalize chapter name from filename
                    chapter_name = p.name.replace(".txt.events.json", "")
                    for ev in events_list:
                        ev["章節"] = chapter_name
                    all_events.extend(events_list)
            except Exception as e:
                log.error(f"Error reading cache {p}: {e}")
                continue
    
    # Consolidate (deduplicate and sort naturally)
    merged = consolidate_timeline_events(all_events)
    
    # Try to extract chapter titles from caches if available
    chapter_titles = {}
    if cache_dir.exists():
        for p in cache_dir.glob("*.events.json"):
            try:
                raw_data = json.loads(p.read_text("utf-8"))
                evs = raw_data.get("data")
                if isinstance(evs, list) and len(evs) > 0:
                    internal_id = p.name.replace(".txt.events.json", "")
                    pretty_name = evs[0].get("章節")
                    if pretty_name and internal_id not in pretty_name:
                        chapter_titles[internal_id] = pretty_name
            except: continue

    # Save to results.json
    res_data = load_novel_results(novel_id)
    res_data["timeline"] = merged
    if chapter_titles:
        existing_titles = res_data.get("chapter_titles", {})
        existing_titles.update(chapter_titles)
        res_data["chapter_titles"] = existing_titles
    save_novel_results(novel_id, res_data)
    return merged


# ── 5. Timeline consolidation ────────────────────────────────────────────────────

async def run_build_timeline(novel_id: str, all_events: list) -> list:
    """
    Consolidate a novel timeline deterministically from extracted events.

    NOTE: The frontend expects timeline items to use the same schema as
    extract_events (事件名稱/事件描述/涉及角色/章節/重要性). The previous LLM-based
    timeline prompt produced a different schema and broke downstream merges.
    """
    return consolidate_timeline_events(all_events)


# ── 6. Story Summary ────────────────────────────────────────────────────────────

async def run_extract_summary(
    novel_id: str,
    chapter: str,
    text_or_chunks: str | list[str],
    use_cache: bool = True,
) -> str:
    """
    Extract a chapter-level summary.

    Caching is keyed on the FULL chapter text (not just a sliced prefix),
    so cache check/load remains consistent across endpoints.
    """
    if isinstance(text_or_chunks, list):
        chunks = [c for c in text_or_chunks if c]
        full_text = "".join(chunks)
    else:
        full_text = text_or_chunks or ""
        chunks = _chunk_text(full_text, chunk_size=6000, max_chunks=4)

    if use_cache:
        # 1. Check local chapter cache
        cached = load_cache("summary", novel_id, chapter, full_text)
        if cached is not None:
            log.info("[Hit] Summary: %s", chapter)
            return cached
        else:
            log.info("[No Found] Summary: %s", chapter)

        # 2. Check global results for this chapter's summary block
        res_data = load_novel_results(novel_id)
        raw_summary = res_data.get("summary", "")
        if f"### {chapter}" in raw_summary:
            # Extract the specific block
            pattern = re.compile(rf"(?m)^###\s+{re.escape(chapter)}\s*$\n([\s\S]*?)(?=\n###\s+|$)", re.MULTILINE)
            match = pattern.search(raw_summary)
            if match:
                s_text = match.group(1).strip()
                if s_text:
                    log.info("Found existing summary for %s in global results, skipping extraction.", chapter)
                    save_cache("summary", novel_id, chapter, full_text, s_text)
                    return s_text

    messages = story_summary_prompt(chunks)
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    res = raw.strip()

    save_cache("summary", novel_id, chapter, full_text, res)
    return res


# ── 7. Export to Assistant ───────────────────────────────────────────────────────

def export_to_assistant(novel_id: str, results_data: dict | None = None):
    """
    Format results into Assistant JSON format and Markdown files.
    Saves to c:/Users/user/Downloads/novel/assistant/{novel_id}
    """
    base_dir = Path(r"C:\Users\user\Downloads\novel\assistant") / novel_id
    base_dir.mkdir(parents=True, exist_ok=True)
    
    # Always load the canonical novel-level results
    novel_res = load_novel_results(novel_id)
    chapter_titles = novel_res.get("chapter_titles", {})

    # 1. JSON Export (for reading assistant app)
    ai_chars = novel_res.get("characters", [])
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
    
    events = novel_res.get("timeline", [])
    for ev in events:
        involved = ev.get("涉及角色", [])
        raw_ch = ev.get("章節", "未知章節")
        # Use pretty name if available
        ch_display = chapter_titles.get(raw_ch, raw_ch)
        
        for name in involved:
            target = next((fc for fc in formatted_chars if fc["name"] == name), None)
            if target:
                if not any(a["chapterTitle"] == ch_display for a in target["appearances"]):
                    target["appearances"].append({
                        "chapterTitle": ch_display,
                        "description": ev.get("事件描述", "")
                    })

    json_path = base_dir / "novel_data.json"
    json_path.write_text(json.dumps({"characters": formatted_chars}, ensure_ascii=False, indent=2), "utf-8")

    # 2. Markdown - Characters
    char_md = [f"# {novel_id} 角色總表\n"]
    for c in ai_chars:
        name = c.get("角色名稱", "未知")
        aliases = ", ".join(c.get("別名", [])) if isinstance(c.get("別名"), list) else c.get("別名", "")
        char_md.append(f"## {name} {' (' + aliases + ')' if aliases else ''}")
        char_md.append(f"- **身份**: {c.get('身份', '未知')}")
        char_md.append(f"- **能力**: {', '.join(c.get('能力', [])) if isinstance(c.get('能力'), list) else c.get('能力', '無')}")
        char_md.append(f"- **描述**: {c.get('角色描述', '無')}\n")
    (base_dir / "Characters.md").write_text("\n".join(char_md), "utf-8")

    # 3. Markdown - Summary
    summary_md = [f"# {novel_id} 故事大綱\n"]
    summary_md.append(novel_res.get("aggregate_summary") or novel_res.get("summary") or "尚無大綱")
    (base_dir / "Summary.md").write_text("\n".join(summary_md), "utf-8")

    # 4. Markdown - Timeline
    timeline_md = [f"# {novel_id} 劇情時間軸\n"]
    for ev in events:
        raw_ch = ev.get("章節", "")
        ch_display = chapter_titles.get(raw_ch, raw_ch)
        importance = ev.get("重要性", "中")
        timeline_md.append(f"### [{ch_display}] {ev.get('事件名稱', '未知事件')} (重要性: {importance})")
        timeline_md.append(f"{ev.get('事件描述', '')}")
        roles = ev.get("涉及角色", [])
        if roles:
            timeline_md.append(f"**涉及角色**: {', '.join(roles)}\n")
    (base_dir / "Timeline.md").write_text("\n".join(timeline_md), "utf-8")

    return str(base_dir)


# ── 8. Name normalization ────────────────────────────────────────────────────────

async def run_normalize_names(novel_id: str, text: str) -> dict:
    name_dict = _load_name_dict()
    messages = normalize_names_prompt(text, name_dict)
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    try:
        result = _parse_json(raw)
        return result.get("name_map", {})
    except Exception:
        return {}


# ── 9. Novel-level results merge (characters / summary / timeline) ──────────────

def load_novel_results(novel_id: str) -> dict:
    res_path = RESULTS_DIR / f"{novel_id}.json"
    default = {
        "characters": [], "summary": "", "timeline": [], "novel": novel_id,
        "aggregate_summary": "", "aggregate_characters": []
    }
    if not res_path.exists():
        return default
    try:
        content = res_path.read_text("utf-8").strip()
        if not content:
            return default
        data = json.loads(content)
        if not isinstance(data, dict):
            return default
        data.setdefault("characters", [])
        data.setdefault("summary", "")
        data.setdefault("timeline", [])
        data.setdefault("novel", novel_id)
        # Aggregate fields – fall back to per-chapter data if absent
        data.setdefault("aggregate_summary", "")
        data.setdefault("aggregate_characters", data.get("characters", []))

        # Timeline schema migration: drop legacy entries that don't carry chapter info.
        tl = data.get("timeline")
        if isinstance(tl, list):
            data["timeline"] = [ev for ev in tl if isinstance(ev, dict) and str(ev.get("章節", "")).strip()]
        else:
            data["timeline"] = []

        if not isinstance(data.get("characters"), list):
            data["characters"] = []
        if not isinstance(data.get("aggregate_characters"), list):
            data["aggregate_characters"] = data.get("characters", [])
        if not isinstance(data.get("summary"), str):
            data["summary"] = ""
        if not isinstance(data.get("aggregate_summary"), str):
            data["aggregate_summary"] = ""
        return data
    except Exception:
        return default


def _chapter_sort_key(chapter: str):
    s = str(chapter or "")
    return [int(c) if c.isdigit() else c for c in re.split(r"(\d+)", s)]


def _importance_rank(value: str) -> int:
    v = (value or "").strip()
    return {"高": 2, "中": 1, "低": 0}.get(v, 1)


def consolidate_timeline_events(events: list[dict]) -> list[dict]:
    """
    Merge, deduplicate, and sort extracted event objects into a "timeline".
    Output schema matches extract_events_prompt.
    """
    if not events:
        return []

    merged: dict[tuple[str, str], dict] = {}

    for ev in events:
        if not isinstance(ev, dict):
            continue
        name = (ev.get("事件名稱") or "").strip()
        chapter = (ev.get("章節") or "").strip()
        if not name:
            continue

        key = (name.lower(), chapter.lower())
        current = merged.get(key)
        if current is None:
            merged[key] = ev
            continue

        # Merge into existing event entry.
        cur_desc = (current.get("事件描述") or "").strip()
        new_desc = (ev.get("事件描述") or "").strip()
        if len(new_desc) > len(cur_desc):
            current["事件描述"] = ev.get("事件描述")

        cur_roles = current.get("涉及角色") or []
        new_roles = ev.get("涉及角色") or []
        if not isinstance(cur_roles, list):
            cur_roles = [str(cur_roles)]
        if not isinstance(new_roles, list):
            new_roles = [str(new_roles)]
        role_set = {str(x).strip() for x in cur_roles + new_roles if str(x).strip()}
        current["涉及角色"] = sorted(role_set)

        cur_imp = _importance_rank(current.get("重要性"))
        new_imp = _importance_rank(ev.get("重要性"))
        if new_imp > cur_imp:
            current["重要性"] = ev.get("重要性")

        # Prefer the chapter field if missing.
        if not current.get("章節") and ev.get("章節"):
            current["章節"] = ev.get("章節")

    timeline = list(merged.values())
    timeline.sort(key=lambda x: _chapter_sort_key(x.get("章節", "")))
    return timeline


def _merge_characters(existing_chars: list[dict], incoming_chars: list[dict]) -> list[dict]:
    if not incoming_chars:
        return existing_chars or []

    existing_chars = existing_chars or []

    # Map canonical name -> character dict
    name_to_char: dict[str, dict] = {}
    alias_to_canonical: dict[str, str] = {}

    for c in existing_chars:
        if not isinstance(c, dict):
            continue
        main_name = c.get("角色名稱")
        if not main_name:
            continue
        name_to_char[main_name] = c
        alias_to_canonical[main_name] = main_name
        aliases = c.get("別名", []) or []
        if isinstance(aliases, list):
            for a in aliases:
                if a:
                    alias_to_canonical[str(a)] = main_name
        else:
            alias_to_canonical[str(aliases)] = main_name

    for c in incoming_chars:
        if not isinstance(c, dict):
            continue
        new_name = c.get("角色名稱")
        if not new_name:
            continue

        canonical = alias_to_canonical.get(new_name)
        if canonical and canonical in name_to_char:
            target = name_to_char[canonical]
            for key, value in c.items():
                if key == "角色名稱":
                    continue
                
                # List-based fields to accumulate
                if key in ("能力", "性格特徵", "人際關係", "別名"):
                    existing_list = target.get(key) or []
                    if not isinstance(existing_list, list):
                        existing_list = [str(existing_list)]
                    
                    incoming_list = value or []
                    if not isinstance(incoming_list, list):
                        incoming_list = [str(incoming_list)]
                    
                    # Merge and deduplicate
                    merged_set = {str(x).strip() for x in existing_list + incoming_list if str(x).strip()}
                    
                    # If it's the alias list, remove the canonical name itself
                    if key == "別名" and canonical in merged_set:
                        merged_set.remove(canonical)
                        
                    target[key] = sorted(list(merged_set))
                
                elif key == "角色描述":
                    # Keep the longest description or append if significantly different? 
                    # For now, keep the longest as per previous logic
                    if value and len(str(value)) > len(str(target.get(key, "") or "")):
                        target[key] = value
                else:
                    # For other fields, only set if currently empty
                    if (not target.get(key)) and value:
                        target[key] = value
        else:
            # New canonical character
            name_to_char[new_name] = c
            alias_to_canonical[new_name] = new_name
            aliases = c.get("別名", []) or []
            if isinstance(aliases, list):
                for a in aliases:
                    if a:
                        alias_to_canonical[str(a)] = new_name
            elif aliases:
                alias_to_canonical[str(aliases)] = new_name

    return list(name_to_char.values())


def _format_chapter_summary_block(chapter: str, summary_text: str) -> str:
    ch = (chapter or "").strip()
    s = (summary_text or "").strip()
    if not ch or not s:
        return ""
    return f"### {ch}\n{s}"


def _upsert_summary_block(existing_summary: str, chapter: str, summary_text: str) -> str:
    """
    Upserts or replaces a chapter summary block and ensures all blocks are sorted.
    Blocks are delimited by ### Header.
    """
    ch = (chapter or "").strip()
    s = (summary_text or "").strip()
    if not ch or not s:
        return (existing_summary or "").strip()

    # Split existing into blocks
    blocks: dict[str, str] = {}
    if existing_summary:
        # Match ### Title\nContent
        # Using a regex that captures the title and the content until the next header
        pattern = re.compile(r"(?m)^###\s+(.+?)\s*$\n([\s\S]*?)(?=\n###\s+|$)", re.MULTILINE)
        for match in pattern.finditer(existing_summary):
            t, content = match.groups()
            blocks[t.strip()] = content.strip()

    # Add/Update current
    blocks[ch] = s

    # Sort keys naturally
    sorted_titles = sorted(blocks.keys(), key=_chapter_sort_key)

    # Reconstruct
    output = []
    for title in sorted_titles:
        output.append(f"### {title}\n{blocks[title]}")

    return "\n\n".join(output).strip()


def save_novel_results(novel_id: str, data: dict) -> Path:
    res_path = RESULTS_DIR / f"{novel_id}.json"
    res_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    return res_path


async def run_consolidate_characters(novel_id: str, new_characters: list) -> list:
    """
    Uses LLM to perform deep consolidation of new characters into the global list.
    This handles description merging and filters out minor characters.
    """
    if not new_characters:
        return []

    data = load_novel_results(novel_id)
    existing_chars = data.get("characters", [])
    
    if not existing_chars:
        return new_characters

    # --- Pre-check Optimization ---
    # If all new_characters names already exist in existing_chars 
    # and their descriptions aren't significantly improved, skip LLM.
    all_known = True
    for nc in new_characters:
        name = nc.get("角色名稱")
        if not name: continue
        
        # Find if this character or an alias exists
        existing = next((c for c in existing_chars if c.get("角色名稱") == name or name in (c.get("別名") or [])), None)
        if not existing:
            all_known = False
            break
        
        # If the new description is significantly longer, we might want the LLM to merge/improve it
        new_desc_len = len(str(nc.get("角色描述", "")))
        old_desc_len = len(str(existing.get("角色描述", "")))
        if new_desc_len > old_desc_len + 50: # Threshold for significant improvement
            all_known = False
            break
            
    if all_known:
        log.info("All incoming characters are already known and well-described. Skipping LLM consolidation.")
        return existing_chars

    # --- Continue with LLM Consolidation ---

    # RAG filtering: Only send existing characters that match the new characters
    # (either by name or alias overlap) to prevent prompt overflow and focus the LLM.
    new_names_and_aliases = set()
    for nc in new_characters:
        name = nc.get("角色名稱")
        if name: new_names_and_aliases.add(name)
        aliases = nc.get("別名", [])
        if isinstance(aliases, list):
            for a in aliases: new_names_and_aliases.add(a)
    
    relevant_existing = []
    irrelevant_existing = []
    
    for ec in existing_chars:
        name = ec.get("角色名稱")
        aliases = ec.get("別名", [])
        
        is_relevant = (name in new_names_and_aliases)
        if not is_relevant and isinstance(aliases, list):
            is_relevant = any(a in new_names_and_aliases for a in aliases)
            
        if is_relevant:
            relevant_existing.append(ec)
        else:
            irrelevant_existing.append(ec)

    if not relevant_existing:
        messages = merge_characters_prompt(
            "[]", 
            json.dumps(new_characters, ensure_ascii=False)
        )
    else:
        messages = merge_characters_prompt(
            json.dumps(relevant_existing, ensure_ascii=False),
            json.dumps(new_characters, ensure_ascii=False)
        )
    
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    try:
        merged_subset = _parse_json(raw)
        if not isinstance(merged_subset, list):
            return existing_chars
            
        # Reconstruct full list: irrelevant + merged_subset
        final_map = {c.get("角色名稱"): c for c in irrelevant_existing if c.get("角色名稱")}
        for mc in merged_subset:
            name = mc.get("角色名稱")
            if name:
                final_map[name] = mc
                
        return list(final_map.values())
    except Exception as e:
        log.error(f"Failed to parse merged characters from LLM: {e}")
        return _merge_characters(existing_chars, new_characters)



_novel_locks: dict[str, asyncio.Lock] = {}

async def update_novel_results(
    novel_id: str,
    characters: list[dict] | None = None,
    chapter_summaries: list[tuple[str, str]] | None = None,
    events: list[dict] | None = None,
) -> dict:
    """
    Merge new chapter outputs into novel-level results.json.
    """
    if novel_id not in _novel_locks:
        _novel_locks[novel_id] = asyncio.Lock()
    lock = _novel_locks[novel_id]

    # Locked save: re-read fresh data and write atomically
    async with lock:
        data = load_novel_results(novel_id)

        if characters:
            # Incremental merge: fast, name-based accumulation (no LLM)
            data["characters"] = _merge_characters(data.get("characters", []), characters)
            data["aggregate_characters"] = data["characters"]

        if chapter_summaries:
            summary_text = data.get("summary", "")
            for ch, s in chapter_summaries:
                summary_text = _upsert_summary_block(summary_text, ch, s)
            data["summary"] = summary_text

        if events:
            # Ensure all events use the same chapter key for deduplication
            existing = data.get("timeline", []) or []
            merged = consolidate_timeline_events(existing + events)
            data["timeline"] = merged
            
            # Update chapter titles map if possible
            titles = data.get("chapter_titles", {})
            for ev in events:
                raw_ch = ev.get("章節")
                if raw_ch and "html" not in raw_ch: # Looks like a pretty name
                    # Find which internal ID this matches (tricky without context, 
                    # but usually it's passed in as filename in the loop)
                    pass 
            # Note: Pretty names are best captured during run_extract_events or rebuild_timeline

        data["novel"] = data.get("novel") or novel_id
        save_novel_results(novel_id, data)
        return data



async def run_consolidate_all_characters(novel_id: str) -> list:
    """
    Exhaustively reads all chapter character caches and merges them into a clean, 
    de-duplicated global list using LLM.
    """
    novel_cache_dir = CACHE_DIR / novel_id
    all_raw_chars = []

    if novel_cache_dir.exists():
        # Collect from all *.chars.json in the cache
        for p in novel_cache_dir.glob("*.chars.json"):
            try:
                raw_data = json.loads(p.read_text("utf-8"))
                chars_list = raw_data.get("data") if isinstance(raw_data, dict) else raw_data
                
                if isinstance(chars_list, list):
                    all_raw_chars.extend(chars_list)
            except Exception as e:
                log.error(f"Error reading character cache {p}: {e}")
                continue
    
    if not all_raw_chars:
        # Fallback to existing results.json
        res = load_novel_results(novel_id)
        all_raw_chars = res.get("characters", [])
    
    if not all_raw_chars:
        return []

    # Local pre-dedup by exact name to reduce LLM payload
    seen = {}
    for c in all_raw_chars:
        name = c.get("角色名稱")
        if not name: continue
        # Keep the one with more information (longer string representation)
        if name not in seen or len(str(c)) > len(str(seen[name])):
            seen[name] = c
    
    compact_chars = list(seen.values())
    
    # If it's still too many, we take only the most important looking ones or do it in batches.
    # For now, let's try a single pass.
    messages = global_consolidate_characters_prompt(json.dumps(compact_chars, ensure_ascii=False))
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    
    try:
        final_chars = _parse_json(raw)
        if isinstance(final_chars, list):
            data = load_novel_results(novel_id)
            data["characters"] = final_chars
            # Also sync to aggregate_characters if main.py uses it
            data["aggregate_characters"] = final_chars
            save_novel_results(novel_id, data)
            return final_chars
    except Exception as e:
        log.error(f"Failed to parse consolidated characters: {e}")
    
    return compact_chars

async def run_consolidate_novel_summary(novel_id: str) -> str:
    """
    LLM-based consolidation: merge all per-chapter summary blocks stored in
    results.json into a single prose novel-level aggregate_summary.
    Saves the result back to results.json and returns it.
    """
    data = load_novel_results(novel_id)
    summary_blocks = data.get("summary", "").strip()
    if not summary_blocks:
        return data.get("aggregate_summary", "")

    # Extract individual chapter paragraphs (### Chapter\n...) or use raw text
    block_pattern = re.compile(r"(?m)^###\s+.+$")
    chunks: list[str] = []
    parts = block_pattern.split(summary_blocks)
    headers = block_pattern.findall(summary_blocks)
    for i, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
        if i < len(headers):
            chunks.append(f"{headers[i-1]}\n{part}" if i > 0 else part)
        else:
            chunks.append(part)
    if not chunks:
        chunks = [summary_blocks]

    existing_agg = data.get("aggregate_summary", "")
    messages = aggregate_summary_prompt(chunks, existing_agg)
    raw = await chat(messages, max_tokens=MAX_TOKENS_ANALYSIS)
    agg = raw.strip()
    if agg:
        data["aggregate_summary"] = agg
        save_novel_results(novel_id, data)
    return agg


def _chunk_text(text: str, chunk_size: int = 6000, max_chunks: int = 4) -> list[str]:
    t = (text or "").replace("\r\n", "\n").strip()
    if not t:
        return [""]
    chunks: list[str] = []
    idx = 0
    while idx < len(t) and len(chunks) < max_chunks:
        chunks.append(t[idx: idx + chunk_size])
        idx += chunk_size
    return chunks
