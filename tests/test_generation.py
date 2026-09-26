import json

import httpx
import pytest

from rulekeeper.generation import answer_question, validate_answer
from rulekeeper.models import AskRequest, Evidence

SOURCE = Evidence(
    id="concentration",
    title="Concentration",
    category="Rules Glossary",
    text="Your Concentration ends if you have the Incapacitated condition or you die.",
    page_start=179,
    page_end=179,
    source_url="https://example.test",
    citation=1,
    score=1,
    lexical_score=1,
    dense_score=1,
)
SUPPORT = ["1:1"]


@pytest.mark.parametrize(
    "value",
    [
        {"answer": "Yes. [8]", "insufficient": False},
        {"answer": "Yes.", "insufficient": False},
        {"answer": "Yes. [1]\n\nAlso an unsupported claim.", "insufficient": False},
        {"answer": "Yes. [1]", "insufficient": "false"},
        {"answer": 42, "insufficient": False},
    ],
)
def test_invalid_generation_is_rejected(value):
    with pytest.raises(ValueError):
        validate_answer(json.dumps({"support": SUPPORT, **value}), [SOURCE])


def test_valid_citations_are_checked():
    assert validate_answer(
        json.dumps(
            {"support": SUPPORT, "answer": "Your concentration ends. [1]", "insufficient": False}
        ),
        [SOURCE],
    ) == ("Your concentration ends. [1]", [1], False)


@pytest.mark.parametrize(
    "support",
    [
        [],
        ["1:99"],
        ["99:1"],
    ],
)
def test_missing_or_fabricated_support_is_rejected(support):
    with pytest.raises(ValueError):
        validate_answer(
            json.dumps({"support": support, "answer": "It ends. [1]", "insufficient": False}),
            [SOURCE],
        )


def test_unsupported_edition_abstains_without_retrieval(retriever, indexed_settings):
    answer = answer_question(
        AskRequest(question="What does the 2014 grappling rule say?"), retriever, indexed_settings
    )
    assert answer.status == "insufficient_evidence"
    assert answer.evidence == []


def test_provider_failure_returns_real_excerpts_without_leaking_error(
    monkeypatch, indexed_settings
):
    evidence = Evidence(
        id="a",
        title="Concentration",
        category="Rules Glossary",
        text="Your Concentration ends when you become Incapacitated.",
        page_start=179,
        page_end=179,
        source_url="https://example.test",
        citation=1,
        lexical_score=8,
        dense_score=0.8,
        rerank_score=4,
    )

    class StubRetriever:
        def search(self, *args, **kwargs):
            return [evidence], {"mode": "hybrid", "retrieval_ms": 1}

    def fail(*args):
        raise httpx.ConnectError("secret token should never reach the browser")

    monkeypatch.setattr("rulekeeper.generation.generate", fail)
    settings = indexed_settings.model_copy(update={"provider": "local"})
    answer = answer_question(
        AskRequest(question="Does incapacitation end concentration?"), StubRetriever(), settings
    )
    assert answer.status == "sources_only"
    assert evidence.text in answer.answer
    assert "secret token" not in answer.model_dump_json()
    assert answer.trace["generation_fallback"]
