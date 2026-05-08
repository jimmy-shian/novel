
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

def get_llm_config():
    vurls = os.getenv("VLLM_BASE_URLS", "").strip()
    if vurls:
        base_urls = [u.strip() for u in vurls.split(",") if u.strip()]
    else:
        # Fallback to single VLLM_BASE_URL if VLLM_BASE_URLS is missing or empty
        base_urls = [VLLM_BASE_URL]
    
    # Filter out empty or invalid entries
    base_urls = [u for u in base_urls if u and u.startswith("http")]
    
    # Default concurrency: 1 per server if not specified
    default_concurrency = len(base_urls) * 4 if base_urls else 4
    max_concurrency = int(os.getenv("LLM_MAX_CONCURRENCY", str(default_concurrency)))
    return base_urls, max_concurrency

def _get_clients() -> list[AsyncOpenAI]:
    global _clients
    if _clients is None:
        base_urls, _ = get_llm_config()
        log.info(f"Initializing LLM Clients with {len(base_urls)} endpoints: {base_urls}")
        _clients = [
            AsyncOpenAI(base_url=url, api_key="not-needed")
            for url in base_urls
        ]
    return _clients

def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _, max_concurrency = get_llm_config()
        _semaphore = asyncio.Semaphore(max_concurrency)
        log.info(f"LLM Client initialized with concurrency limit: {max_concurrency}")
    return _semaphore

async def chat(
    messages: list[dict],
    max_tokens: int = 16384,
    temperature: float = TEMPERATURE,
    top_p: float = TOP_P,
) -> str:
    """Send a chat request to the local llm_server_hf.py instances with round-robin balancing."""
    clients = _get_clients()
    num_clients = len(clients)
    if num_clients == 0:
        raise RuntimeError("No LLM clients configured.")

    async with _get_semaphore():
        # Brief stagger to avoid simultaneous spikes on multiple request start
        await asyncio.sleep(0.05) 
        
        last_error: Exception | None = None
        # Use round-robin to decide which client to start with
        start_idx = next(_rr_counter) % num_clients

        # Try every client at least twice if needed
        for attempt_idx in range(num_clients * 2):
            idx = (start_idx + attempt_idx) % num_clients
            client = clients[idx]
            
            try:
                log.info(f"LLM Chat -> Server {idx} [Attempt {attempt_idx+1}]")
                resp = await client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    top_p=top_p,
                    stream=False,
                    timeout=600, # 10 min timeout for complex novel analysis
                )
                return resp.choices[0].message.content or ""
            except Exception as e:
                last_error = e
                err_str = str(e).lower()
                log.warning(f"Server {idx} failed (Attempt {attempt_idx+1}): {e}")
                
                if "429" in err_str or "too many requests" in err_str:
                    # Stagger before next server attempt
                    await asyncio.sleep(2)
                else:
                    # Immediate try next server with brief pause
                    await asyncio.sleep(0.1)

        raise last_error or RuntimeError("All LLM backends failed after exhaustive retries")
