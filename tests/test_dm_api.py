import json

from fastapi.testclient import TestClient

from rulekeeper import api
from rulekeeper.dm import DMError
from rulekeeper.http_guard import MAX_DM_BODY, DMRequestGuard

FAKE_KEY = "sk-test-not-a-real-key-123456789"


def test_connect_keeps_key_out_of_response_and_disables_caching(
    indexed_settings, retriever, monkeypatch
):
    calls = []

    def connect(key):
        calls.append(key)
        return {"model": "gpt-5.6-sol"}

    monkeypatch.setattr(api, "check_key", connect)
    with TestClient(api.create_app(indexed_settings, retriever)) as client:
        response = client.post(
            "/api/dm/connect",
            headers={"Authorization": f"Bearer {FAKE_KEY}", "Origin": "http://testserver"},
        )
    assert calls == [FAKE_KEY]
    assert response.status_code == 200
    assert response.json() == {"model": "gpt-5.6-sol"}
    assert response.headers["cache-control"] == "no-store"
    assert FAKE_KEY not in response.text


def test_connect_requires_personal_key_even_if_server_key_exists(
    indexed_settings, retriever, monkeypatch
):
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    monkeypatch.setattr(
        api, "check_key", lambda _: (_ for _ in ()).throw(AssertionError("Must not call OpenAI"))
    )
    with TestClient(api.create_app(indexed_settings, retriever)) as client:
        for header in (
            {},
            {"Authorization": "Bearer short"},
            {"Authorization": f"Basic {FAKE_KEY}"},
        ):
            response = client.post("/api/dm/connect", headers=header)
            assert response.status_code == 401
            assert FAKE_KEY not in response.text


def test_untrusted_origin_and_host_cannot_use_dm(indexed_settings, retriever, monkeypatch):
    monkeypatch.setattr(
        api, "check_key", lambda _: (_ for _ in ()).throw(AssertionError("Must not call OpenAI"))
    )
    with TestClient(api.create_app(indexed_settings, retriever)) as client:
        for headers in (
            {"Origin": "https://other.example"},
            {"Origin": "null"},
            {"Origin": "http://testserver.evil.example"},
            {"Origin": "http://testserver", "Sec-Fetch-Site": "cross-site"},
        ):
            response = client.post(
                "/api/dm/connect", headers={**headers, "Authorization": f"Bearer {FAKE_KEY}"}
            )
            assert response.status_code == 403
            assert response.headers["cache-control"] == "no-store"
        assert (
            client.post("/api/dm/connect", headers={"Host": "untrusted.example"}).status_code == 400
        )


def test_dm_errors_are_actionable_and_slots_are_released(indexed_settings, retriever, monkeypatch):
    def fail(_):
        raise DMError(429, "OpenAI usage limit reached.")

    monkeypatch.setattr(api, "check_key", fail)
    with TestClient(api.create_app(indexed_settings, retriever)) as client:
        for _ in range(4):
            response = client.post(
                "/api/dm/connect", headers={"Authorization": f"Bearer {FAKE_KEY}"}
            )
            assert response.status_code == 429
            assert response.json()["detail"] == "OpenAI usage limit reached."


def test_dice_endpoint_uses_server_randomness_and_validates_expression(
    indexed_settings, retriever, monkeypatch
):
    monkeypatch.setattr("rulekeeper.dm.secrets.randbelow", lambda _: 7)
    with TestClient(api.create_app(indexed_settings, retriever)) as client:
        roll = {
            "label": "Stealth",
            "notation": "1d20+3",
            "mode": "advantage",
            "reason": "Cross the courtyard.",
        }
        response = client.post("/api/dm/roll", json=roll)
        assert response.status_code == 200
        assert response.json()["rolls"] == [8, 8]
        assert response.json()["kept"] == [8]
        assert response.json()["total"] == 11
        assert response.headers["cache-control"] == "no-store"
        assert client.post("/api/dm/roll", json={**roll, "notation": "999d20"}).status_code == 422
        assert client.post("/api/dm/roll", json={**roll, "notation": "2d6"}).status_code == 422


def test_oversized_body_rejected_before_json_parsing(indexed_settings, retriever):
    with TestClient(api.create_app(indexed_settings, retriever)) as client:
        response = client.post("/api/dm/turn", content=b"x" * (MAX_DM_BODY + 1))
        assert response.status_code == 413


def test_streamed_body_limit_does_not_depend_on_content_length():
    import asyncio

    called = False
    sent = []
    messages = iter(
        [
            {"type": "http.request", "body": b"x" * MAX_DM_BODY, "more_body": True},
            {"type": "http.request", "body": b"x", "more_body": False},
        ]
    )

    async def downstream(*_):
        nonlocal called
        called = True

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    asyncio.run(
        DMRequestGuard(downstream)(
            {
                "type": "http",
                "path": "/api/dm/turn",
                "method": "POST",
                "scheme": "http",
                "headers": [],
            },
            receive,
            send,
        )
    )
    assert not called
    assert sent[0]["status"] == 413
    assert "too large" in json.loads(sent[1]["body"])["detail"]
