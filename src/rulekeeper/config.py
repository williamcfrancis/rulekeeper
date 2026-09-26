from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]
SOURCE_URL = "https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf"
SOURCE_SHA256 = "8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87"
EDITION = "5.2.1"
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
RERANKER_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RULEKEEPER_", env_file=ROOT / ".env", extra="ignore"
    )
    data_dir: Path = ROOT / "data"
    provider: Literal["evidence", "local", "openai"] = "evidence"
    local_base_url: str = "http://127.0.0.1:8081/v1"
    local_model: str = "qwen3-4b"
    openai_model: str = ""
    rerank: bool = True
    model_threads: int = 4
    generation_timeout: float = 90.0

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "index"

    @property
    def source_path(self) -> Path:
        return self.data_dir / "source" / "SRD_CC_v5.2.1.pdf"

    @property
    def model_cache(self) -> Path:
        return self.data_dir / "index" / "models"
