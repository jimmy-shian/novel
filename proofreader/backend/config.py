"""
Central configuration for the Novel Proofreader backend.
Adjust VLLM_BASE_URL / MODEL_PATH to match your local vLLM server.
"""
import os
from pathlib import Path

# ── vLLM server ────────────────────────────────────────────────────────────────
VLLM_BASE_URL: str = os.getenv("VLLM_BASE_URL", "http://localhost:8000/v1")
MODEL_PATH: str = os.getenv(
    "MODEL_PATH",
    r"C:\Users\user\Downloads\novel\Model"
)
MODEL_NAME: str = os.getenv("MODEL_NAME", "gptoss20b")

# Inference params
MAX_TOKENS_MARK: int = 2048        # for error-marking task
MAX_TOKENS_ANALYSIS: int = 4096    # for character / plot extraction
TEMPERATURE: float = 0.1
TOP_P: float = 0.9

# ── RAG (Chroma) ───────────────────────────────────────────────────────────────
CHROMA_DIR: Path = Path(os.getenv("CHROMA_DIR", r"C:\Users\user\Downloads\novel\proofreader\data\chroma"))
EMBEDDING_MODEL: str = os.getenv(
    "EMBEDDING_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
RAG_TOP_K: int = 5

# ── Data directories ───────────────────────────────────────────────────────────
DATA_DIR: Path = Path(os.getenv("DATA_DIR", r"C:\Users\user\Downloads\novel\proofreader\data"))
LOGS_DIR: Path = DATA_DIR / "logs"
CACHE_DIR: Path = DATA_DIR / "cache"
NAMES_DICT_PATH: Path = DATA_DIR / "name_dict.json"
RESULTS_DIR: Path = DATA_DIR / "results"

for _d in [CHROMA_DIR, LOGS_DIR, CACHE_DIR, RESULTS_DIR, DATA_DIR]:
    _d.mkdir(parents=True, exist_ok=True)
