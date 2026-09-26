import pytest

from rulekeeper.models import Chunk
from rulekeeper.retrieval import Retriever, named_definitions


def test_version_is_filtered_before_ranking(retriever):
    evidence, _ = retriever.search("concentration", mode="lexical")
    assert evidence and evidence[0].id == "current"
    assert all(e.edition == "5.2.1" for e in evidence)


def test_category_filter_does_not_leak(retriever):
    evidence, _ = retriever.search("Fireball", mode="lexical", category="Rules Glossary")
    assert not evidence


def test_unknown_version_returns_no_evidence(retriever):
    assert retriever.search("concentration", mode="lexical", edition="4.0")[0] == []


def test_empty_meaningful_query_returns_no_evidence(retriever):
    assert retriever.search("the and a", mode="lexical")[0] == []


def test_index_corruption_is_detected(indexed_settings):
    path = indexed_settings.index_dir / "chunks.jsonl"
    path.write_bytes(path.read_bytes().replace(b"Fireball", b"Firebolt"))
    with pytest.raises(ValueError, match="checksum"):
        Retriever(indexed_settings)


def test_missing_semantic_index_does_not_claim_dense_search(retriever):
    with pytest.raises(ValueError, match="Semantic index"):
        retriever.search("concentration", mode="dense")


def test_composite_question_keeps_named_definitions_instead_of_special_spell():
    template = dict(
        edition="5.2.1", page_start=186, page_end=186, source_url="https://example.test"
    )
    chunks = [
        Chunk(
            id="spell",
            title="Power Word Heal",
            category="Spells",
            text="If prone, use a Reaction to stand up.",
            **template,
        ),
        Chunk(
            id="prone",
            title="Prone [Condition]",
            category="Rules Glossary",
            text="You can't right yourself if your Speed is 0.",
            **template,
        ),
        Chunk(
            id="grappled",
            title="Grappled [Condition]",
            category="Rules Glossary",
            text="Your Speed is 0.",
            **template,
        ),
    ]
    anchors = named_definitions("If both prone and grappled, can I stand up?", chunks, [0, 1, 2])
    assert {chunks[i].id for i in anchors} == {"prone", "grappled"}
    assert named_definitions("Is this prone-like homebrew?", chunks, [0]) == []
    assert named_definitions("ungrappled", chunks, [0, 1, 2]) == []
