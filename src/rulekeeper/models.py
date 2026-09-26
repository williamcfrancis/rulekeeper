from typing import Literal

from pydantic import BaseModel, Field


class Chunk(BaseModel):
    id: str
    title: str
    category: str
    text: str
    page_start: int
    page_end: int
    edition: str = "5.2.1"
    source_url: str


class Evidence(Chunk):
    citation: int = 0
    score: float = 0
    lexical_score: float = 0
    dense_score: float = 0
    rerank_score: float | None = None


class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=1500)
    edition: str = "5.2.1"
    mode: Literal["hybrid", "lexical", "dense"] = "hybrid"
    category: str | None = None


class Answer(BaseModel):
    question: str
    answer: str
    status: Literal["answered", "sources_only", "insufficient_evidence"]
    provider: str
    edition: str
    evidence: list[Evidence]
    cited_ids: list[int]
    note: str | None = None
    trace: dict
