import hashlib
import json

import pytest

from rulekeeper.config import Settings
from rulekeeper.models import Chunk
from rulekeeper.retrieval import Retriever


@pytest.fixture
def indexed_settings(tmp_path):
    settings = Settings(data_dir=tmp_path, provider="evidence", rerank=False)
    directory = settings.index_dir
    directory.mkdir()
    chunks = [
        Chunk(
            id="current",
            title="Concentration",
            category="Rules Glossary",
            edition="5.2.1",
            text="Your concentration ends if you have the Incapacitated condition or you die.",
            page_start=179,
            page_end=179,
            source_url="https://example.test/srd.pdf#page=179",
        ),
        Chunk(
            id="old",
            title="Concentration",
            category="Rules Glossary",
            edition="5.1",
            text="Concentration concentration concentration from the previous edition.",
            page_start=100,
            page_end=100,
            source_url="https://example.test/old.pdf#page=100",
        ),
        Chunk(
            id="spell",
            title="Fireball",
            category="Spells",
            edition="5.2.1",
            text="Each creature makes a Dexterity saving throw, taking 8d6 Fire damage.",
            page_start=133,
            page_end=133,
            source_url="https://example.test/srd.pdf#page=133",
        ),
        Chunk(
            id="action",
            title="Dash",
            category="Rules Glossary",
            edition="5.2.1",
            text="Gain extra movement equal to your Speed for the current turn.",
            page_start=180,
            page_end=180,
            source_url="https://example.test/srd.pdf#page=180",
        ),
    ]
    corpus = ("\n".join(c.model_dump_json() for c in chunks) + "\n").encode("utf-8")
    (directory / "chunks.jsonl").write_bytes(corpus)
    manifest = {
        "edition": "5.2.1",
        "chunk_count": len(chunks),
        "page_count": 364,
        "corpus_sha256": hashlib.sha256(corpus).hexdigest(),
        "categories": ["Rules Glossary", "Spells"],
    }
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return settings


@pytest.fixture
def retriever(indexed_settings):
    return Retriever(indexed_settings)
