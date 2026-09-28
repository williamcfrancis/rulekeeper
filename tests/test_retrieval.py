import hashlib
import json

import numpy as np
import pytest

from rulekeeper.config import EMBEDDING_MODEL
from rulekeeper.models import Chunk
from rulekeeper.retrieval import Retriever, core_rule_queries, named_definitions


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


@pytest.mark.parametrize(
    "question",
    [
        "What damage die does Fireball use?",
        "How do I roll a die?",
        "How much fire damage does it deal?",
    ],
)
def test_damage_and_dice_do_not_automatically_request_death_rules(question):
    assert core_rule_queries(question) == []


def test_core_rules_survive_a_reranker_that_prefers_fire_spells(indexed_settings, monkeypatch):
    template = dict(edition="5.2.1", page_start=17, page_end=17, source_url="https://example.test")
    chunks = [
        Chunk(
            id="dead",
            title="Dead",
            category="Rules Glossary",
            text="A dead creature cannot regain Hit Points unless revived by magic.",
            **template,
        ),
        Chunk(
            id="types",
            title="Damage Types",
            category="Rules Glossary",
            text="Damage types have no rules of their own.",
            **template,
        ),
        Chunk(
            id="zero",
            title="Falling Unconscious",
            category="Playing the Game",
            text="At 0 Hit Points, if you don't die instantly, you fall unconscious.",
            **template,
        ),
        Chunk(
            id="instant",
            title="Instant Death",
            category="Playing the Game",
            text="Remaining damage must equal or exceed your Hit Point maximum.",
            **template,
        ),
        Chunk(
            id="saves",
            title="Death Saving Throws",
            category="Playing the Game",
            text="At 0 Hit Points, make Death Saving Throws.",
            **template,
        ),
        Chunk(
            id="old",
            title="Dead",
            category="Rules Glossary",
            text="Other edition.",
            **{**template, "edition": "5.1"},
        ),
    ] + [
        Chunk(
            id=f"spell-{n}",
            title=f"Fire spell {n}",
            category="Spells",
            text="Fire burns burning fire and the target dies from fire.",
            **template,
        )
        for n in range(30)
    ]
    directory = indexed_settings.index_dir
    corpus = ("\n".join(c.model_dump_json() for c in chunks) + "\n").encode()
    (directory / "chunks.jsonl").write_bytes(corpus)
    manifest = json.loads((directory / "manifest.json").read_text())
    manifest.update(
        corpus_sha256=hashlib.sha256(corpus).hexdigest(), embedding_model=EMBEDDING_MODEL
    )
    (directory / "manifest.json").write_text(json.dumps(manifest))
    np.save(directory / "embeddings.npy", np.ones((len(chunks), 384)) / np.sqrt(384))
    engine = Retriever(indexed_settings.model_copy(update={"rerank": True}))

    class Encoder:
        def query_embed(self, query):
            return [np.ones(384)]

    class Reranker:
        def rerank(self, query, documents):
            return [10 if "Fire spell" in text else -5 for text in documents]

    engine._encoder, engine._reranker = Encoder(), Reranker()
    monkeypatch.setattr(engine, "_models", lambda **kwargs: None)
    evidence, trace = engine.search("what happens if i die from fire?")
    assert {e.id for e in evidence[:5]} == {"dead", "types", "zero", "instant", "saves"}
    assert len(evidence) == 6 and all(e.edition == "5.2.1" for e in evidence)
    assert "Dead" in trace["core_rule_anchors"]
    filtered, _ = engine.search("what happens if i die from fire?", category="Spells")
    assert filtered and all(e.category == "Spells" for e in filtered)
    assert engine.search("what happens if i die from fire?", edition="missing")[0] == []
