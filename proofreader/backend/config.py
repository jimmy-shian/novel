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
NVIDIA_API_KEY: str = os.getenv("OVERRIDE_API_KEY", os.getenv("NVIDIA_API_KEY", ""))
GPTOSS_API_KEY: str = os.getenv("OVERRIDE_API_KEY", os.getenv("GPTOSS", ""))
NVIDIA_API_URL: str = "https://integrate.api.nvidia.com/v1"
NVIDIA_MODEL_NAME: str = "openai/gpt-oss-120b"
# NVIDIA_MODEL_NAME: str = "openai/gpt-oss-120b", mistralai/mistral-small-4-119b-2603 ,"qwen/qwen3.5-122b-a10b", "nvidia/nemotron-3-super-120b-a12b"

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
    TEMPERATURE: float = 1.0
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
NOVEL_NAMES_PATH: Path = DATA_DIR / "novel_names.json"

# Ensure all directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
for _d in [LOGS_DIR, CACHE_DIR, RESULTS_DIR, CHROMA_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# Ensure essential files exist
if not NAMES_DICT_PATH.exists():
    NAMES_DICT_PATH.write_text("{}", "utf-8")
if not NOVEL_NAMES_PATH.exists():
    # Example mapping: folder_name -> display_name
    NOVEL_NAMES_PATH.write_text(
        '{"bailianchengxian-huanyu": "百鍊成仙", "doupocangqiong-tiancantudou": "鬥破蒼穹"}', 
        "utf-8"
    )
