
"""
LLM Client - Connects to the local HF Flask Server (llm_server_hf.py).
This client acts as the bridge between tasks.py and the inference server.
"""
import logging
import asyncio
import itertools
import os
from openai import AsyncOpenAI
from config import VLLM_BASE_URL, MODEL_NAME, TEMPERATURE, TOP_P

log = logging.getLogger(__name__)

_clients: list[AsyncOpenAI] | None = None
_semaphore: asyncio.Semaphore | None = None
_rr_counter = itertools.count()

def _get_configs():
    base_urls = [u.strip() for u in os.getenv("VLLM_BASE_URLS", VLLM_BASE_URL).split(",") if u.strip()]
    # If not specified, default to 2 concurrency per server
    default_concurrency = len(base_urls) * 2 if base_urls else 2
    max_concurrency = int(os.getenv("LLM_MAX_CONCURRENCY", str(default_concurrency)))
    return base_urls, max_concurrency

def _get_clients() -> list[AsyncOpenAI]:
    global _clients
    if _clients is None:
        base_urls, _ = _get_configs()
        _clients = [
            AsyncOpenAI(base_url=url, api_key="not-needed")
            for url in (base_urls or [VLLM_BASE_URL])
        ]
    return _clients

def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _, max_concurrency = _get_configs()
        _semaphore = asyncio.Semaphore(max_concurrency)
        log.info(f"LLM Client initialized with concurrency limit: {max_concurrency}")
    return _semaphore

async def chat(
    messages: list[dict],
    max_tokens: int = 16384,
    temperature: float = TEMPERATURE,
    top_p: float = TOP_P,
) -> str:
    """Send a chat request to the local llm_server_hf.py."""
    try:
        async with _get_semaphore():
            clients = _get_clients()
            start_idx = next(_rr_counter) % len(clients)
            last_error: Exception | None = None

            for offset in range(len(clients)):
                client = clients[(start_idx + offset) % len(clients)]
                try:
                    # We request streaming from the local server to see progress in its console,
                    # but return the full string here for the task logic.
                    resp = await client.chat.completions.create(
                        model=MODEL_NAME,
                        messages=messages,
                        max_tokens=max_tokens,
                        temperature=temperature,
                        top_p=top_p,
                        stream=False,  # Client side doesn't need stream, server will do it for logs
                    )
                    return resp.choices[0].message.content or ""
                except Exception as e:
                    last_error = e
                    log.warning(f"LLM Chat backend failed, trying next base_url: {e}")
                    continue

            raise last_error or RuntimeError("No LLM backend available")
    except Exception as e:
        log.error(f"LLM Chat Error: {e}")
        return f"錯誤：無法連線至模型伺服器 ({e})。請確認 llm_server_hf.py 已啟動。"
