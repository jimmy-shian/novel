"""
RAG module: Chroma vector store + sentence-transformers embedding.
Stores novel paragraphs, character data and plot events.
"""
import json
import hashlib
import logging
from typing import Optional

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer

from config import CHROMA_DIR, EMBEDDING_MODEL, RAG_TOP_K

log = logging.getLogger(__name__)

# ── Lazy singletons ─────────────────────────────────────────────────────────────
_chroma: Optional[chromadb.Client] = None
_embedder: Optional[SentenceTransformer] = None

COLLECTIONS = {
    "paragraphs": "novel_paragraphs",
    "characters": "novel_characters",
    "events":     "novel_events",
    "corrections": "novel_corrections",
}


def _get_chroma() -> chromadb.Client:
    global _chroma
    if _chroma is None:
        _chroma = chromadb.PersistentClient(
            path=str(CHROMA_DIR),
            settings=Settings(anonymized_telemetry=False),
        )
    return _chroma


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        log.info("Loading embedding model %s …", EMBEDDING_MODEL)
        _embedder = SentenceTransformer(EMBEDDING_MODEL)
    return _embedder


def _embed(texts: list[str]) -> list[list[float]]:
    return _get_embedder().encode(texts, show_progress_bar=False).tolist()


def _col(name: str):
    return _get_chroma().get_or_create_collection(name)


# ── Public API ──────────────────────────────────────────────────────────────────

def add_paragraphs(novel_id: str, paragraphs: list[str]) -> None:
    """Upsert novel paragraphs into Chroma."""
    col = _col(COLLECTIONS["paragraphs"])
    ids, docs, metas = [], [], []
    for i, p in enumerate(paragraphs):
        if not p.strip():
            continue
        uid = hashlib.md5(f"{novel_id}_{i}_{p[:40]}".encode()).hexdigest()
        ids.append(uid)
        docs.append(p)
        metas.append({"novel_id": novel_id, "para_idx": i})
    if ids:
        col.upsert(ids=ids, documents=docs, embeddings=_embed(docs), metadatas=metas)
    log.info("Upserted %d paragraphs for novel %s", len(ids), novel_id)


def add_character(novel_id: str, char: dict) -> None:
    col = _col(COLLECTIONS["characters"])
    text = json.dumps(char, ensure_ascii=False)
    uid = hashlib.md5(f"{novel_id}_{char.get('角色名稱','')}".encode()).hexdigest()
    col.upsert(ids=[uid], documents=[text], embeddings=_embed([text]),
               metadatas=[{"novel_id": novel_id}])


def add_event(novel_id: str, event: dict) -> None:
    col = _col(COLLECTIONS["events"])
    text = json.dumps(event, ensure_ascii=False)
    uid = hashlib.md5(f"{novel_id}_{event.get('事件名稱','')}_{event.get('章節','')}".encode()).hexdigest()
    col.upsert(ids=[uid], documents=[text], embeddings=_embed([text]),
               metadatas=[{"novel_id": novel_id}])


def add_correction(novel_id: str, original: str, corrected: str) -> None:
    col = _col(COLLECTIONS["corrections"])
    text = f"{original} → {corrected}"
    uid = hashlib.md5(f"{novel_id}_{original}".encode()).hexdigest()
    col.upsert(ids=[uid], documents=[text], embeddings=_embed([text]),
               metadatas=[{"novel_id": novel_id, "original": original, "corrected": corrected}])


def query(
    collection_key: str,
    query_text: str,
    novel_id: str,
    k: int = RAG_TOP_K,
) -> list[str]:
    """Return top-k document strings from the named collection."""
    col = _col(COLLECTIONS[collection_key])
    if col.count() == 0:
        return []
    try:
        results = col.query(
            query_embeddings=_embed([query_text]),
            n_results=min(k, col.count()),
            where={"novel_id": novel_id} if novel_id else None,
        )
        return results["documents"][0] if results["documents"] else []
    except Exception as e:
        log.warning("RAG query failed: %s", e)
        return []


def build_rag_context(novel_id: str, task: str, query_text: str) -> str:
    """
    Build a RAG context string based on task type.
    """
    snippets: list[str] = []

    if task in ("name", "mark"):
        # For marking/naming, focus on name mappings and character identities
        corrections = query("corrections", query_text, novel_id, k=5)
        characters = query("characters", query_text, novel_id, k=5)
        
        if corrections:
            snippets.append("【已知名稱修正紀錄】：")
            snippets.extend([f"• {c}" for c in corrections])
            
        if characters:
            snippets.append("\n【核心人物表】：")
            for c_json in characters:
                try:
                    c = json.loads(c_json)
                    name = c.get("角色名稱", "未知")
                    desc = c.get("角色描述", "") or c.get("身份", "")
                    aliases = f" (別名: {', '.join(c.get('別名', []))})" if c.get("別名") else ""
                    snippets.append(f"• {name}{aliases}: {desc}")
                except:
                    snippets.append(f"• {c_json}")
    
    elif task in ("plot", "character", "event", "events"):
        events = query("events", query_text, novel_id, k=5)
        characters = query("characters", query_text, novel_id, k=5)

        if events:
            snippets.append("【已知事件（僅供銜接，請勿重複輸出）】：")
            for ev_json in events:
                try:
                    ev = json.loads(ev_json)
                    ch = ev.get("章節", "")
                    name = ev.get("事件名稱", "未知事件")
                    desc = ev.get("事件描述", "")
                    roles = ev.get("涉及角色", []) or []
                    roles_s = f"（涉及：{', '.join(roles)}）" if isinstance(roles, list) and roles else ""
                    ch_s = f"[{ch}] " if ch else ""
                    snippets.append(f"• {ch_s}{name}: {desc}{roles_s}".strip())
                except Exception:
                    snippets.append(f"• {ev_json}")

        if characters:
            snippets.append("\n【相關角色參考】：")
            for c_json in characters:
                try:
                    c = json.loads(c_json)
                    name = c.get("角色名稱", "未知")
                    desc = c.get("角色描述", "") or c.get("身份", "")
                    aliases = f" (別名: {', '.join(c.get('別名', []))})" if c.get("別名") else ""
                    snippets.append(f"• {name}{aliases}: {desc}")
                except Exception:
                    snippets.append(f"• {c_json}")

    elif task == "timeline":
        events = query("events", query_text, novel_id, k=RAG_TOP_K)
        if events:
            snippets.append("【已知事件（供時間線整理參考）】：")
            for ev_json in events:
                try:
                    ev = json.loads(ev_json)
                    ch = ev.get("章節", "")
                    name = ev.get("事件名稱", "未知事件")
                    desc = ev.get("事件描述", "")
                    ch_s = f"[{ch}] " if ch else ""
                    snippets.append(f"• {ch_s}{name}: {desc}".strip())
                except Exception:
                    snippets.append(f"• {ev_json}")

    if not snippets:
        return ""
        
    return "\n".join(snippets)
