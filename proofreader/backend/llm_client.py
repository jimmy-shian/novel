"""
vLLM client – thin wrapper around the OpenAI-compatible /v1 endpoint.
"""
from openai import AsyncOpenAI
from config import VLLM_BASE_URL, MODEL_NAME, TEMPERATURE, TOP_P

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            base_url=VLLM_BASE_URL,
            api_key="not-needed",   # vLLM doesn't require a real key
        )
    return _client


async def chat(
    messages: list[dict],
    max_tokens: int = 2048,
    temperature: float = TEMPERATURE,
    top_p: float = TOP_P,
) -> str:
    """Send a chat request to the vLLM server and return the text reply."""
    client = get_client()
    resp = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        top_p=top_p,
    )
    return resp.choices[0].message.content or ""
