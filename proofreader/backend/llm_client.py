
"""
LLM Client - Simple wrapper to connect to the local HF Flask Server.
"""
import logging
from openai import AsyncOpenAI
from config import VLLM_BASE_URL, MODEL_NAME, TEMPERATURE, TOP_P

log = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None

def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        # Connect to the Flask server (it uses the same OpenAI-compatible format)
        _client = AsyncOpenAI(
            base_url=VLLM_BASE_URL,
            api_key="not-needed"
        )
    return _client

async def chat(
    messages: list[dict],
    max_tokens: int = 2048,
    temperature: float = TEMPERATURE,
    top_p: float = TOP_P,
) -> str:
    """Send a chat request to the local Windows HF Flask server."""
    client = get_client()
    try:
        resp = await client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        log.error(f"LLM Chat Error: {e}")
        return f"錯誤：無法連線至本地模型伺服器 ({e})。請確認 Flask 伺服器已啟動完成。"
