import copy
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from rulekeeper import dm
from rulekeeper.api import create_app
from rulekeeper.config import Settings
from rulekeeper.dm_models import (
    Campaign,
    Character,
    DMTurnRequest,
    JournalEntry,
    RollRequest,
    RollResult,
)
from rulekeeper.models import Evidence

KEY = "sk-test-only-not-a-real-api-key"


@pytest.fixture
def campaign():
    return Campaign(
        id="campaign-1",
        title="The Bell Below",
        premise="A bell rings in an abandoned mine.",
        tone="Quiet mystery",
        characters=[
            Character(
                id="pc-1",
                name="Mara",
                ancestry="Human",
                class_name="Fighter",
                level=1,
                hp=12,
                max_hp=12,
                armor_class=16,
                notes="Athletics +5",
            )
        ],
        location="Mine gate",
        summary="The gate is locked. The key is missing.",
        quests=["Find the source of the bell"],
        npcs=[],
        inventory=["Lantern"],
        turn_count=0,
        history=[],
        pending_roll=None,
    )


@pytest.fixture
def roll_request():
    return RollRequest(
        label="Athletics check", notation="1d20+5", mode="normal", reason="Force the locked gate"
    )


class FakeRetriever:
    def __init__(self, evidence=True):
        self.queries = []
        self.evidence = evidence

    def search(self, query, **kwargs):
        self.queries.append((query, kwargs))
        return (
            [
                Evidence(
                    id="ability-check",
                    title="Ability checks",
                    category="Rules Glossary",
                    text="Roll a d20 and add the relevant ability modifier.",
                    page_start=4,
                    page_end=4,
                    source_url="https://example.test/srd.pdf#page=4",
                    citation=1,
                )
            ]
            if self.evidence
            else []
        ), {}


def generated(campaign):
    return {
        "narration": "The iron gate shudders. Beyond it, a bell rings once. What do you do?",
        "location": "Mine gate",
        "summary": "Mara reached the locked mine gate. The bell sounded once.",
        "quests": campaign.quests,
        "npcs": campaign.npcs,
        "inventory": campaign.inventory,
        "characters": [character.model_dump() for character in campaign.characters],
        "pending_roll": None,
        "rulings": [{"text": "A check uses a d20 and the relevant modifier.", "citations": [1]}],
    }


def completed(turn, **kwargs):
    return {
        "status": "completed",
        "output": [
            {"type": "reasoning", "summary": []},
            {"type": "message", "content": [{"type": "output_text", "text": json.dumps(turn)}]},
        ],
        "usage": {"input_tokens": 120, "output_tokens": 80, "total_tokens": 200},
        **kwargs,
    }


def transport(monkeypatch, handler):
    original_client = httpx.Client

    def client(**kwargs):
        assert kwargs["trust_env"] is False
        assert kwargs["follow_redirects"] is False
        return original_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(dm.httpx, "Client", client)


def test_turn_uses_fixed_model_bounded_context_and_keeps_identity(monkeypatch, campaign):
    campaign.history = [
        JournalEntry(role="player" if i % 2 else "dm", text=f"Event {i}") for i in range(30)
    ]
    campaign.turn_count = 15
    original = campaign.model_dump()
    seen = {}

    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/responses"
        assert request.headers["Authorization"] == f"Bearer {KEY}"
        seen.update(json.loads(request.content))
        assert KEY not in request.content.decode()
        return httpx.Response(200, json=completed(generated(campaign)))

    transport(monkeypatch, handler)
    retriever = FakeRetriever()
    result = dm.run_turn(
        DMTurnRequest(campaign=campaign, action="Inspect the gate"), retriever, Settings(), KEY
    )
    assert seen["model"] == "gpt-5.6-sol"
    assert seen["store"] is False
    assert seen["reasoning"] == {"effort": "low"}
    assert seen["max_output_tokens"] == 10000
    assert seen["text"]["format"]["strict"] is True
    context = json.loads(seen["input"][0]["content"])
    assert len(context["campaign"]["history"]) == 12
    assert context["campaign"]["history"][0]["text"] == "Event 18"
    assert context["campaign"]["summary"] == campaign.summary
    assert context["evidence"][0]["id"] == 1
    assert retriever.queries == [
        ("Inspect the gate Mine gate", {"mode": "hybrid", "edition": "5.2.1", "limit": 6})
    ]
    assert result.campaign.turn_count == 16
    assert result.campaign.title == campaign.title
    assert result.campaign.premise == campaign.premise
    assert result.campaign.history[-2].text == "Inspect the gate"
    assert result.campaign.history[-1].text == result.narration
    assert result.model == "gpt-5.6-sol"
    assert result.usage == {"input_tokens": 120, "output_tokens": 80, "total_tokens": 200}
    assert campaign.model_dump() == original
    assert KEY not in result.model_dump_json()


@pytest.mark.parametrize(
    "mode,rolled,kept,total",
    [("normal", [4], [4], 9), ("advantage", [4, 17], [17], 22), ("disadvantage", [4, 17], [4], 9)],
)
def test_rolls_use_real_dice_and_correct_mode(monkeypatch, mode, rolled, kept, total):
    values = iter([value - 1 for value in rolled])
    monkeypatch.setattr(dm.secrets, "randbelow", lambda sides: next(values))
    result = dm.roll_dice(
        RollRequest(label="Check", notation="1d20+5", mode=mode, reason="Lift the gate")
    )
    assert result.rolls == rolled
    assert result.kept == kept
    assert result.total == total


def test_multiple_dice_with_negative_modifier(monkeypatch):
    monkeypatch.setattr(dm.secrets, "randbelow", lambda sides: sides - 1)
    result = dm.roll_dice(
        RollRequest(label="Damage", notation="2d6-2", reason="Damage from the resolved hit")
    )
    assert result.rolls == [6, 6]
    assert result.total == 10


@pytest.mark.parametrize(
    "notation,mode",
    [
        ("0d20", "normal"),
        ("21d6", "normal"),
        ("1d3", "normal"),
        ("1d20+101", "normal"),
        ("2d20", "advantage"),
        ("1d6", "disadvantage"),
        ("1d20; print('bad')", "normal"),
    ],
)
def test_invalid_dice_are_rejected(notation, mode):
    with pytest.raises(ValidationError):
        RollRequest(label="Check", notation=notation, mode=mode, reason="Gate")


@pytest.mark.parametrize(
    "change",
    [
        {"total": 99},
        {"rolls": [21], "kept": [21], "total": 26},
        {"kept": [2], "total": 7},
        {"rolls": [1, 2]},
        {"modifier": 7, "total": 19},
        {"rolls": [True], "kept": [True], "total": 6},
    ],
)
def test_forged_or_mismatched_roll_arithmetic_rejected(roll_request, change):
    data = {
        "request": roll_request,
        "rolls": [12],
        "kept": [12],
        "modifier": 5,
        "total": 17,
        **change,
    }
    with pytest.raises(ValidationError):
        RollResult(**data)


def test_pending_roll_requires_matching_result_before_provider_call(
    campaign, roll_request, monkeypatch
):
    campaign.pending_roll = roll_request
    monkeypatch.setattr(
        dm.httpx, "Client", lambda **kwargs: pytest.fail("No network request expected")
    )
    with pytest.raises(dm.DMError, match="Resolve the requested dice roll") as error:
        dm.run_turn(
            DMTurnRequest(campaign=campaign, action="Continue"), FakeRetriever(), Settings(), KEY
        )
    assert error.value.status_code == 409
    other = roll_request.model_copy(update={"label": "Different roll"})
    roll = RollResult(request=other, rolls=[12], kept=[12], modifier=5, total=17)
    with pytest.raises(dm.DMError, match="Resolve the requested dice roll"):
        dm.run_turn(
            DMTurnRequest(campaign=campaign, action="Continue", roll=roll),
            FakeRetriever(),
            Settings(),
            KEY,
        )


def test_pending_roll_result_is_sent_to_model_and_returned(monkeypatch, campaign, roll_request):
    campaign.pending_roll = roll_request
    roll = RollResult(request=roll_request, rolls=[12], kept=[12], modifier=5, total=17)

    def handler(request):
        context = json.loads(json.loads(request.content)["input"][0]["content"])
        assert context["roll"] == roll.model_dump()
        return httpx.Response(200, json=completed(generated(campaign)))

    transport(monkeypatch, handler)
    result = dm.run_turn(
        DMTurnRequest(campaign=campaign, action="Resolve the check", roll=roll),
        FakeRetriever(),
        Settings(),
        KEY,
    )
    assert result.roll == roll
    assert result.campaign.pending_roll is None


def test_roll_without_pending_request_is_rejected(campaign, roll_request):
    roll = RollResult(request=roll_request, rolls=[12], kept=[12], modifier=5, total=17)
    with pytest.raises(dm.DMError, match="There is no pending roll"):
        dm.run_turn(
            DMTurnRequest(campaign=campaign, action="Continue", roll=roll),
            FakeRetriever(),
            Settings(),
            KEY,
        )


@pytest.mark.parametrize(
    "status,expected", [(401, 401), (403, 403), (404, 403), (429, 429), (500, 502), (302, 502)]
)
def test_upstream_failures_never_expose_provider_response(monkeypatch, campaign, status, expected):
    transport(
        monkeypatch,
        lambda request: httpx.Response(
            status, json={"error": f"Secret {KEY} and provider internals"}
        ),
    )
    original = campaign.model_dump()
    with pytest.raises(dm.DMError) as error:
        dm.run_turn(
            DMTurnRequest(campaign=campaign, action="Look around"), FakeRetriever(), Settings(), KEY
        )
    assert error.value.status_code == expected
    assert KEY not in str(error.value)
    assert "internals" not in str(error.value)
    assert campaign.model_dump() == original


@pytest.mark.parametrize(
    "response",
    [
        {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}},
        {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "refusal", "refusal": "Raw refusal content"}],
                }
            ],
        },
        {"status": "completed", "output": []},
        {"status": "completed", "output": "bad"},
    ],
)
def test_incomplete_refused_and_missing_output_leave_campaign_unchanged(
    monkeypatch, campaign, response
):
    transport(monkeypatch, lambda request: httpx.Response(200, json=response))
    original = campaign.model_dump()
    with pytest.raises(dm.DMError):
        dm.run_turn(
            DMTurnRequest(campaign=campaign, action="Look around"), FakeRetriever(), Settings(), KEY
        )
    assert campaign.model_dump() == original


@pytest.mark.parametrize(
    "mutation", ["citation", "roster", "hp", "narration_citation", "identity", "invalid_roll"]
)
def test_invalid_generated_state_is_rejected_atomically(monkeypatch, campaign, mutation):
    turn = copy.deepcopy(generated(campaign))
    if mutation == "citation":
        turn["rulings"][0]["citations"] = [2]
    elif mutation == "roster":
        turn["characters"][0]["id"] = "invented-character"
    elif mutation == "hp":
        turn["characters"][0]["hp"] = 900
    elif mutation == "narration_citation":
        turn["narration"] += " [99]"
    elif mutation == "identity":
        turn["title"] = "Hijacked title"
    else:
        turn["pending_roll"] = {
            "label": "Check",
            "notation": "2d20",
            "mode": "advantage",
            "reason": "Jump",
        }
    transport(monkeypatch, lambda request: httpx.Response(200, json=completed(turn)))
    original = campaign.model_dump()
    with pytest.raises(dm.DMError) as error:
        dm.run_turn(
            DMTurnRequest(campaign=campaign, action="Look around"), FakeRetriever(), Settings(), KEY
        )
    assert error.value.status_code == 502
    assert campaign.model_dump() == original


def test_uncited_rulings_are_explicit_dm_judgment(monkeypatch, campaign):
    turn = generated(campaign)
    turn["rulings"] = [{"text": "The rotten bridge cannot hold a wagon.", "citations": []}]
    transport(monkeypatch, lambda request: httpx.Response(200, json=completed(turn)))
    result = dm.run_turn(
        DMTurnRequest(campaign=campaign, action="Test the bridge"),
        FakeRetriever(evidence=False),
        Settings(),
        KEY,
    )
    assert result.rulings[0].text == "DM judgment: The rotten bridge cannot hold a wagon."
    assert result.evidence == []


def test_network_timeout_is_sanitized(monkeypatch, campaign):
    def handler(request):
        raise httpx.ReadTimeout(f"Internal error with {KEY}")

    transport(monkeypatch, handler)
    with pytest.raises(dm.DMError) as error:
        dm.run_turn(
            DMTurnRequest(campaign=campaign, action="Look around"), FakeRetriever(), Settings(), KEY
        )
    assert error.value.status_code == 504
    assert KEY not in str(error.value)


def test_check_key_uses_model_access_endpoint_without_generation(monkeypatch):
    def handler(request):
        assert request.method == "GET"
        assert str(request.url) == "https://api.openai.com/v1/models/gpt-5.6-sol"
        assert request.headers["Authorization"] == f"Bearer {KEY}"
        assert request.content == b""
        return httpx.Response(200, json={"id": "gpt-5.6-sol"})

    transport(monkeypatch, handler)
    assert dm.check_key(KEY) == {"model": "gpt-5.6-sol"}


@pytest.mark.parametrize(
    "key",
    ["", "short", "has a space and is long enough", "x" * 513, "x" * 20 + "\nInjected: header"],
)
def test_invalid_credentials_rejected_without_a_network_request(monkeypatch, key):
    monkeypatch.setattr(
        dm.httpx, "Client", lambda **kwargs: pytest.fail("No network request expected")
    )
    with pytest.raises(dm.DMError) as error:
        dm.check_key(key)
    assert error.value.status_code == 401


def test_request_size_bound_counts_utf8_bytes(campaign):
    campaign.history = [JournalEntry(role="player", text="🌙" * 5000) for _ in range(6)]
    with pytest.raises(ValidationError, match="under 100 KB"):
        DMTurnRequest(campaign=campaign, action="Continue")


def test_long_journal_is_trimmed_to_a_reusable_campaign(monkeypatch, campaign):
    campaign.history = [JournalEntry(role="dm", text="x" * 460) for _ in range(200)]
    transport(monkeypatch, lambda request: httpx.Response(200, json=completed(generated(campaign))))
    result = dm.run_turn(
        DMTurnRequest(campaign=campaign, action="Continue"), FakeRetriever(), Settings(), KEY
    )
    assert len(result.campaign.history) < 200
    assert result.campaign.history[-1].text == result.narration
    DMTurnRequest(campaign=result.campaign, action="🌙" * 2000)


def test_strict_schema_requires_all_properties_and_rejects_extra_keys():
    def visit(value):
        if isinstance(value, dict):
            assert "default" not in value
            if value.get("type") == "object":
                assert value["additionalProperties"] is False
                assert set(value["required"]) == set(value["properties"])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(dm._strict_schema())


def test_full_api_turn_roll_resolution_with_mocked_openai(
    monkeypatch, campaign, roll_request, indexed_settings
):
    """Exercise real routes, real engine validation, and server dice together."""
    provider_calls = []

    def handler(request):
        assert str(request.url) == "https://api.openai.com/v1/responses"
        context = json.loads(json.loads(request.content)["input"][0]["content"])
        provider_calls.append(context)
        turn = generated(campaign)
        if len(provider_calls) == 1:
            assert context["roll"] is None
            turn["narration"] = "The gate resists. Roll Athletics to force it open."
            turn["pending_roll"] = roll_request.model_dump()
            turn["summary"] = "Mara tries to force the locked gate. An Athletics check is pending."
        else:
            assert context["roll"]["total"] == 17
            assert context["campaign"]["pending_roll"] == roll_request.model_dump()
            turn["narration"] = "The gate gives way. A stair descends into the mine."
            turn["location"] = "Mine entrance"
            turn["summary"] = "Mara forced the gate open with an Athletics total of 17."
        return httpx.Response(200, json=completed(turn))

    transport(monkeypatch, handler)
    monkeypatch.setattr(dm.secrets, "randbelow", lambda sides: 11)
    headers = {"Authorization": f"Bearer {KEY}", "Origin": "http://testserver"}
    with TestClient(create_app(indexed_settings, FakeRetriever())) as client:
        first = client.post(
            "/api/dm/turn",
            json={"campaign": campaign.model_dump(), "action": "Force the gate open"},
            headers=headers,
        )
        assert first.status_code == 200, first.text
        waiting = first.json()
        assert waiting["campaign"]["pending_roll"] == roll_request.model_dump()
        assert waiting["campaign"]["turn_count"] == 1
        assert waiting["campaign"]["characters"][0]["hp"] == 12
        rolled = client.post("/api/dm/roll", json=waiting["campaign"]["pending_roll"])
        assert rolled.status_code == 200, rolled.text
        assert rolled.json()["total"] == 17
        second = client.post(
            "/api/dm/turn",
            json={
                "campaign": waiting["campaign"],
                "action": "Resolve the Athletics check",
                "roll": rolled.json(),
            },
            headers=headers,
        )
        assert second.status_code == 200, second.text
        resolved = second.json()
        assert resolved["campaign"]["pending_roll"] is None
        assert resolved["campaign"]["turn_count"] == 2
        assert resolved["campaign"]["location"] == "Mine entrance"
        assert len(resolved["campaign"]["history"]) == 4
        assert resolved["roll"] == rolled.json()
        assert resolved["evidence"][0]["citation"] == 1
        assert second.headers["cache-control"] == "no-store"
        assert KEY not in second.text
    assert len(provider_calls) == 2
