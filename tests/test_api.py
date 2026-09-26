from fastapi.testclient import TestClient

from rulekeeper.api import create_app


def test_full_lexical_question_to_citation_flow(indexed_settings, retriever):
    with TestClient(create_app(indexed_settings, retriever)) as client:
        assert client.get("/api/health").json()["status"] == "ready"
        response = client.post(
            "/api/ask",
            json={
                "question": "Does incapacitation end concentration?",
                "mode": "lexical",
            },
        )
        assert response.status_code == 200
        answer = response.json()
        assert answer["status"] == "sources_only"
        assert answer["provider"] == "evidence"
        assert answer["evidence"][0]["id"] == "current"
        assert client.get("/api/rules/current").json()["page_start"] == 179
        assert client.get("/api/rules/missing").status_code == 404


def test_compendium_filters_and_pagination(indexed_settings, retriever):
    with TestClient(create_app(indexed_settings, retriever)) as client:
        data = client.get(
            "/api/rules", params={"category": "Spells", "q": "Fire", "limit": 1}
        ).json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == "spell"
        assert client.get("/api/rules?offset=-1").status_code == 422


def test_question_limits_and_whitespace(indexed_settings, retriever):
    with TestClient(create_app(indexed_settings, retriever)) as client:
        assert client.post("/api/ask", json={"question": "   "}).status_code == 422
        assert client.post("/api/ask", json={"question": "x" * 1501}).status_code == 422


def test_fresh_install_reports_missing_index(indexed_settings):
    (indexed_settings.index_dir / "manifest.json").unlink()
    with TestClient(create_app(indexed_settings)) as client:
        assert client.get("/api/health").json()["status"] == "setup_required"
        assert client.get("/api/library").status_code == 503
