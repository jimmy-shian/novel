"""
Central configuration for the Novel Proofreader backend.
Adjust VLLM_BASE_URL / MODEL_PATH to match your local vLLM server.
"""
import os
from pathlib import Path

# ── vLLM / HF Server settings ──────────────────────────────────────────────────
from dotenv import load_dotenv
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(env_path)

USE_LOCAL_VLLM: bool = False
VLLM_BASE_URL: str = os.getenv("VLLM_BASE_URL", "http://127.0.0.1:8000/v1")

# NVIDIA API Settings
NVIDIA_API_KEY: str = os.getenv("NVIDIA_API_KEY", "")
GPTOSS_API_KEY: str = os.getenv("GPTOSS", "")
NVIDIA_API_URL: str = "https://integrate.api.nvidia.com/v1"
NVIDIA_MODEL_NAME: str = "openai/gpt-oss-120b" # Switched to gpt-oss-120b as requested
# NVIDIA_MODEL_NAME: str = "qwen/qwen3.5-397b-a17b"

# Use project-relative paths to avoid encoding/path issues
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BASE_DIR / "data"

MODEL_PATH: str = os.getenv("MODEL_PATH", r"C:\Users\user\Downloads\novel\Model")
MODEL_NAME: str = os.getenv("MODEL_NAME", "gptoss20b")

# Inference params
if USE_LOCAL_VLLM:
    MAX_TOKENS_MARK: int = 2048
    MAX_TOKENS_ANALYSIS: int = 4096
    TEMPERATURE: float = 0.1
    TOP_P: float = 0.9
else:
    # API allows much larger context/outputs
    MAX_TOKENS_MARK: int = 16384
    MAX_TOKENS_ANALYSIS: int = 16384
    TEMPERATURE: float = 0.6
    TOP_P: float = 0.95

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
