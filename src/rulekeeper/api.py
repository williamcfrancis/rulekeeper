import json
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import EDITION, ROOT, Settings
from .dm import DMError, check_key, roll_dice, run_turn
from .dm_models import DMTurnRequest, DMTurnResponse, RollRequest, RollResult
from .generation import answer_question
from .http_guard import DMRequestGuard
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

    app = FastAPI(title="RuleKeeper", version="0.2.0", lifespan=lifespan)
    app.add_middleware(DMRequestGuard)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.allowed_hosts)
    app.state.retriever = retriever

    def engine():
        if app.state.retriever is None:
            raise HTTPException(
                503, "The rule library has not been indexed. Run rulekeeper ingest."
            )
        return app.state.retriever

    def personal_key(authorization: str | None) -> str:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "Connect your OpenAI API key to use Dungeon Master.")
        key = authorization[7:]
        if not 20 <= len(key) <= 512 or not key.isascii() or any(c.isspace() for c in key):
            raise HTTPException(401, "Enter a valid OpenAI API key.")
        return key

    @app.post("/api/dm/connect")
    def dm_connect(authorization: str | None = Header(default=None)):
        key = personal_key(authorization)
        if not slots.acquire(blocking=False):
            raise HTTPException(429, "The table is busy. Try again shortly.")
        try:
            return check_key(key)
        except DMError as exc:
            raise HTTPException(exc.status_code, exc.public_message) from None
        finally:
            slots.release()

    @app.post("/api/dm/roll", response_model=RollResult)
    def dm_roll(request: RollRequest):
        return roll_dice(request)

    @app.post("/api/dm/turn", response_model=DMTurnResponse)
    def dm_turn(request: DMTurnRequest, authorization: str | None = Header(default=None)):
        key = personal_key(authorization)
        retrieval = engine()
        if not slots.acquire(blocking=False):
            raise HTTPException(
                429, "The table is busy. Your action is still here; try again shortly."
            )
        try:
            return run_turn(request, retrieval, config, key)
        except DMError as exc:
            raise HTTPException(exc.status_code, exc.public_message) from None
        except ValueError:
            raise HTTPException(
                503, "The rule index needs rebuilding. Run rulekeeper ingest."
            ) from None
        finally:
            slots.release()

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
