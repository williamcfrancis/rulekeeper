import json
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import EDITION, ROOT, Settings
from .generation import answer_question
from .models import Answer, AskRequest
from .retrieval import Retriever


def create_app(settings: Settings | None = None, retriever=None) -> FastAPI:
    config = settings or Settings()
    slots = threading.BoundedSemaphore(2)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if app.state.retriever is None and (config.index_dir / "manifest.json").exists():
            app.state.retriever = Retriever(config)
        yield

    app = FastAPI(title="RuleKeeper", version="0.1.0", lifespan=lifespan)
    app.state.retriever = retriever

    def engine():
        if app.state.retriever is None:
            raise HTTPException(
                503, "The rule library has not been indexed. Run rulekeeper ingest."
            )
        return app.state.retriever

    @app.get("/api/health")
    def health():
        return {"status": "ready" if app.state.retriever else "setup_required", "edition": EDITION}

    @app.get("/api/library")
    def library():
        retrieval = engine()
        return {
            **retrieval.manifest,
            "provider": config.provider,
            "semantic_ready": retrieval.vectors is not None,
            "rerank_enabled": config.rerank,
        }

    @app.post("/api/ask", response_model=Answer)
    def ask(request: AskRequest):
        if not request.question.strip() or len(request.question.strip()) < 3:
            raise HTTPException(422, "Please enter a rules question.")
        retrieval = engine()
        if not slots.acquire(blocking=False):
            raise HTTPException(
                429, "The librarian is answering other questions. Try again shortly."
            )
        try:
            return answer_question(request, retrieval, config)
        except ValueError as exc:
            raise HTTPException(
                503, "The search index needs rebuilding. Run rulekeeper ingest."
            ) from exc
        finally:
            slots.release()

    @app.get("/api/rules")
    def rules(
        q: str = Query("", max_length=200),
        category: str | None = None,
        offset: int = Query(0, ge=0),
        limit: int = Query(24, ge=1, le=100),
    ):
        matches = [
            c
            for c in engine().chunks
            if c.edition == EDITION
            and (not category or c.category == category)
            and (not q or q.casefold() in c.title.casefold())
        ]
        return {"total": len(matches), "items": matches[offset : offset + limit]}

    @app.get("/api/rules/{chunk_id}")
    def rule(chunk_id: str):
        value = engine().by_id.get(chunk_id)
        if value is None or value.edition != EDITION:
            raise HTTPException(404, "Passage not found")
        return value

    @app.get("/api/evaluation")
    def evaluation():
        path = ROOT / "eval" / "results.json"
        return (
            json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"available": False}
        )

    @app.get("/api/source.pdf")
    def source():
        if not config.source_path.exists():
            raise HTTPException(404, "Run rulekeeper ingest to download the official source.")
        return FileResponse(
            config.source_path,
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="SRD-5.2.1.pdf"'},
        )

    distribution = ROOT / "web" / "dist"
    if distribution.exists():
        app.mount("/", StaticFiles(directory=distribution, html=True), name="web")
    return app


app = create_app()
