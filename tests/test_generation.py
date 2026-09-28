import json

import httpx
import pytest

from rulekeeper.generation import GenerationFailure, answer_question, generate, validate_answer
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


def generated(*, support=None, text="Your concentration ends.", insufficient=False):
    selected = SUPPORT if support is None else support
    return json.dumps(
        {
            "claims": [
                {"support": selected, "text": text},
                {"support": selected, "text": "Incapacitation ends Concentration."},
            ],
            "insufficient": insufficient,
        }
    )


@pytest.mark.parametrize(
    "value",
    [
        {"claims": [], "insufficient": False},
        {"claims": [42, 42], "insufficient": False},
        {"claims": [{"text": "Yes", "support": SUPPORT}] * 4, "insufficient": False},
        {"claims": [{"text": "Yes", "support": SUPPORT}] * 2, "insufficient": "false"},
    ],
)
def test_invalid_generation_is_rejected(value):
    with pytest.raises(ValueError):
        validate_answer(json.dumps(value), [SOURCE])


def test_citations_are_built_from_each_claims_support():
    other = SOURCE.model_copy(update={"citation": 4, "id": "other"})
    value = json.loads(generated())
    value["claims"][1]["support"] = ["4:1"]
    answer, cited, insufficient = validate_answer(json.dumps(value), [SOURCE, other])
    assert answer == "Your concentration ends. [1]\n\nIncapacitation ends Concentration. [4]"
    assert cited == [1, 4] and not insufficient


@pytest.mark.parametrize("support", [[], ["1:99"], ["99:1"], [None], "1:1", ["1:1"] * 5])
def test_missing_or_fabricated_support_is_rejected(support):
    with pytest.raises(ValueError):
        validate_answer(generated(support=support), [SOURCE])


def test_one_supported_claim_cannot_hide_an_unsupported_claim():
    value = json.loads(generated())
    value["claims"][1]["support"] = []
    with pytest.raises(ValueError):
        validate_answer(json.dumps(value), [SOURCE])


def test_a_complete_supported_answer_does_not_require_filler():
    value = json.loads(generated())
    value["claims"] = value["claims"][:1]
    assert validate_answer(json.dumps(value), [SOURCE]) == (
        "Your concentration ends. [1]",
        [1],
        False,
    )


@pytest.mark.parametrize("text", ["", "Yes. [8]", "Yes. [1:99]", 42])
def test_empty_nontext_or_freeform_citations_are_rejected(text):
    with pytest.raises(ValueError):
        validate_answer(generated(text=text), [SOURCE])


def test_insufficient_answer_can_have_no_claimed_sources():
    _, citations, insufficient = validate_answer(generated(support=[], insufficient=True), [SOURCE])
    assert citations == [] and insufficient


@pytest.mark.parametrize("marker", ["(1:1)", "(1:1-1:1)", "(1:1/1:1)"])
def test_known_inline_clause_markers_are_removed_but_unknown_ones_fail(marker):
    answer, citations, _ = validate_answer(
        generated(text=f"Concentration ends {marker}."), [SOURCE]
    )
    assert "(1:1)" not in answer and citations == [1]
    with pytest.raises(ValueError, match="unknown clause"):
        validate_answer(generated(text="Concentration ends (9:1)."), [SOURCE])


def test_death_context_preserves_the_question_scope(monkeypatch, indexed_settings):
    titles = ["Dead", "Damage Types", "Falling Unconscious", "Instant Death", "Death Saving Throws"]
    evidence = [
        SOURCE.model_copy(
            update={
                "id": title,
                "title": title,
                "citation": n,
                "category": "Playing the Game",
                "text": "A complete rule sentence.",
                "rerank_score": 4.0,
            }
        )
        for n, title in enumerate(titles, 1)
    ]

    class StubRetriever:
        def search(self, *args, **kwargs):
            return evidence, {"core_rule_anchors": titles, "retrieval_ms": 1}

    contexts = []

    def compose(settings, question, context):
        contexts.append([e.title for e in context])
        return generated(), {}

    monkeypatch.setattr("rulekeeper.generation.generate", compose)
    settings = indexed_settings.model_copy(update={"provider": "local"})
    answer_question(
        AskRequest(question="what happens if i die from fire?"), StubRetriever(), settings
    )
    assert contexts[-1] == ["Dead", "Damage Types", "Falling Unconscious", "Death Saving Throws"]
    answer_question(
        AskRequest(question="How much fire damage causes instant death?"), StubRetriever(), settings
    )
    assert "Instant Death" in contexts[-1]


def test_local_request_reserves_output_for_the_answer(monkeypatch, indexed_settings):
    original_client = httpx.Client

    def respond(request):
        body = json.loads(request.content)
        assert request.url.host == "127.0.0.1"
        assert 0 < body["reasoning_budget_tokens"] < body["max_tokens"]
        assert body["max_tokens"] - body["reasoning_budget_tokens"] >= 600
        schema = body["response_format"]["json_schema"]["schema"]
        refs = schema["properties"]["claims"]["items"]["properties"]["support"]["items"]["enum"]
        assert refs == ["1:1"]
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "stop", "message": {"content": generated()}}],
                "usage": {"completion_tokens": 100},
            },
        )

    monkeypatch.setattr(
        "rulekeeper.generation.httpx.Client",
        lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    settings = indexed_settings.model_copy(update={"provider": "local"})
    output, usage = generate(settings, "Does incapacitation end concentration?", [SOURCE])
    assert validate_answer(output, [SOURCE])[1] == [1]
    assert usage["completion_tokens"] == 100


def test_truncated_local_output_is_not_treated_as_a_complete_answer(monkeypatch, indexed_settings):
    original_client = httpx.Client
    monkeypatch.setattr(
        "rulekeeper.generation.httpx.Client",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "choices": [
                            {"finish_reason": "length", "message": {"content": generated()}}
                        ],
                    },
                )
            ),
            **kwargs,
        ),
    )
    with pytest.raises(GenerationFailure, match="output_limit"):
        generate(indexed_settings.model_copy(update={"provider": "local"}), "Why?", [SOURCE])


def test_unsupported_edition_abstains_without_retrieval(retriever, indexed_settings):
    answer = answer_question(
        AskRequest(question="What does the 2014 grappling rule say?"), retriever, indexed_settings
    )
    assert answer.status == "insufficient_evidence"
    assert answer.evidence == []


@pytest.mark.parametrize(
    "error, code, note",
    [
        (httpx.ConnectError("secret token"), "connection_error", "could not be reached"),
        (httpx.ReadTimeout("secret token"), "timeout", "timed out"),
        (GenerationFailure("output_limit"), "output_limit", "output limit"),
        (ValueError("secret token"), "invalid_response", "source-reference checks"),
    ],
)
def test_provider_failure_returns_real_excerpts_without_leaking_error(
    monkeypatch, indexed_settings, error, code, note
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
        raise error

    monkeypatch.setattr("rulekeeper.generation.generate", fail)
    settings = indexed_settings.model_copy(update={"provider": "local"})
    answer = answer_question(
        AskRequest(question="Does incapacitation end concentration?"), StubRetriever(), settings
    )
    assert answer.status == "sources_only"
    assert evidence.text in answer.answer
    assert "secret token" not in answer.model_dump_json()
    assert answer.trace["generation_fallback"]
    assert answer.trace["generation_error"] == code
    assert note in answer.note
