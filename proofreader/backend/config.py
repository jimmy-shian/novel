"""
Central configuration for the Novel Proofreader backend.
Adjust VLLM_BASE_URL / MODEL_PATH to match your local vLLM server.
"""
import os
from pathlib import Path

# ── vLLM / HF Server settings ──────────────────────────────────────────────────
USE_LOCAL_VLLM: bool = False
VLLM_BASE_URL: str = os.getenv("VLLM_BASE_URL", "http://127.0.0.1:8000/v1")

# Use project-relative paths to avoid encoding/path issues
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BASE_DIR / "data"

MODEL_PATH: str = os.getenv("MODEL_PATH", r"C:\Users\user\Downloads\novel\Model")
MODEL_NAME: str = os.getenv("MODEL_NAME", "gptoss20b")

# Inference params
MAX_TOKENS_MARK: int = 2048
MAX_TOKENS_ANALYSIS: int = 4096
TEMPERATURE: float = 0.1
TOP_P: float = 0.9

# ── RAG (Chroma) ───────────────────────────────────────────────────────────────
DATA_DIR: Path = Path(os.getenv("DATA_DIR", str(DEFAULT_DATA_DIR)))
CHROMA_DIR: Path = DATA_DIR / "chroma"

EMBEDDING_MODEL: str = os.getenv(
    "EMBEDDING_MODEL",
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
RAG_TOP_K: int = 5

# ── Data subdirectories ────────────────────────────────────────────────────────
LOGS_DIR: Path = DATA_DIR / "logs"
CACHE_DIR: Path = DATA_DIR / "cache"
NAMES_DICT_PATH: Path = DATA_DIR / "name_dict.json"
RESULTS_DIR: Path = DATA_DIR / "results"

for _d in [DATA_DIR, CHROMA_DIR, LOGS_DIR, CACHE_DIR, RESULTS_DIR]:
    _d.mkdir(parents=True, exist_ok=True)
