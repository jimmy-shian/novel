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
    Build a RAG context string based on task type:
      - 'name'      → query characters + corrections
      - 'plot'      → query events + paragraphs
      - 'character' → query paragraphs
      - 'timeline'  → query events
      - 'mark'      → query corrections + characters
    """
    snippets: list[str] = []

    if task in ("name", "mark"):
        snippets += query("corrections", query_text, novel_id, k=3)
        snippets += query("characters", query_text, novel_id, k=3)
    elif task in ("plot", "character"):
        snippets += query("paragraphs", query_text, novel_id, k=3)
        snippets += query("events", query_text, novel_id, k=2)
    elif task == "timeline":
        snippets += query("events", query_text, novel_id, k=RAG_TOP_K)

    if not snippets:
        return ""
    return "\n\n---參考資料---\n" + "\n\n".join(snippets[:RAG_TOP_K])
