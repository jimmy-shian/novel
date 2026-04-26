
"""
LLM Client - Connects to the local HF Flask Server (llm_server_hf.py).
This client acts as the bridge between tasks.py and the inference server.
"""
import logging
from openai import AsyncOpenAI
from config import VLLM_BASE_URL, MODEL_NAME, TEMPERATURE, TOP_P

log = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None

def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        # ALWAYS connect to the local proxy server (llm_server_hf.py)
        # It handles model switching, local inference, and NVIDIA proxying.
        _client = AsyncOpenAI(
            base_url=VLLM_BASE_URL,
            api_key="not-needed"
        )
    return _client

async def chat(
    messages: list[dict],
    max_tokens: int = 16384,
    temperature: float = TEMPERATURE,
    top_p: float = TOP_P,
) -> str:
    """Send a chat request to the local llm_server_hf.py."""
    client = get_client()
    try:
        # We request streaming from the local server to see progress in its console,
        # but return the full string here for the task logic.
        resp = await client.chat.completions.create(
            model=MODEL_NAME, 
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=False # Client side doesn't need stream, server will do it for logs
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        log.error(f"LLM Chat Error: {e}")
        return f"錯誤：無法連線至模型伺服器 ({e})。請確認 llm_server_hf.py 已啟動。"
