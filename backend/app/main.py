"""FastAPI app. Exactly three endpoints: /health, /chat, /sessions/{session_id}/messages."""

from __future__ import annotations

import asyncio
import logging
import math
from collections import defaultdict
from contextlib import asynccontextmanager
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings
from .db import Database
from .llm import AllProvidersDown, Gateway
from .schemas import ChatRequest, ChatResponse, HistoryResponse
from .simulate import parse_simulation

log = logging.getLogger("pakka")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    db = Database(settings.database_path)
    gateway = Gateway(settings)
    session_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await db.init()  # schema is created on startup
        await gateway.warm_up()
        log.info("ready: %d keys, model %s", len(settings.api_keys), settings.model)
        yield

    app = FastAPI(title="Pakka backend", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["*"],
        allow_headers=["*"],  # the browser preflights X-Simulate-Failure
    )

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled %s", type(exc).__name__)  # never the message: it may hold user text
        return JSONResponse(status_code=500, content={"detail": "internal error"})

    @app.get("/health")
    async def health():
        try:
            await db.ping()
        except Exception:
            return JSONResponse(status_code=503, content={"detail": "database unreachable"})
        return {
            "status": "ok",
            "keys_configured": len(settings.api_keys),
            "cache_enabled": True,
            "simulation_enabled": settings.enable_failure_simulation,
            "model": settings.model,
        }

    @app.post("/chat", response_model=ChatResponse)
    async def chat(req: ChatRequest, request: Request):
        started = perf_counter()
        sim = (
            parse_simulation(request.headers.get("x-simulate-failure"))
            if settings.enable_failure_simulation
            else None  # switch off: the header is ignored completely
        )
        async with session_locks[req.session_id]:
            state = await db.load_session(req.session_id)
            system_prompt = req.system_prompt or state.system_prompt or settings.default_system_prompt
            messages = [
                {"role": "system", "content": system_prompt},
                *state.history,
                {"role": "user", "content": req.message},
            ]
            try:
                answer = await gateway.answer(messages, sim)
            except AllProvidersDown:
                # Nothing is written: a failed request never enters the history.
                return JSONResponse(status_code=503, content={"detail": "all providers unavailable"})

            latency_ms = max(1, math.ceil((perf_counter() - started) * 1000))
            metadata = {
                "resolution_source": answer.resolution_source,
                "model": answer.model,
                "latency_ms": latency_ms,
                "input_tokens": answer.input_tokens,
                "output_tokens": answer.output_tokens,
                "key_id": answer.key_id,
                "fallback_attempts": answer.fallback_attempts,
                "cache_key": answer.cache_key[:32],
                "attempts": answer.attempts,
            }
            # The system prompt is stored only when this request set it.
            await db.save_turn(req.session_id, req.system_prompt, req.message, answer.reply, metadata)

        log.info(
            "chat session=%s source=%s key=%s fallbacks=%d latency_ms=%d",
            req.session_id, answer.resolution_source, answer.key_id, answer.fallback_attempts, latency_ms,
        )
        return {"session_id": req.session_id, "reply": answer.reply, "metadata": metadata}

    @app.get("/sessions/{session_id}/messages", response_model=HistoryResponse)
    async def history(session_id: str):
        messages = await db.messages(session_id)
        if messages is None:
            return JSONResponse(status_code=404, content={"detail": "session not found"})
        return {"session_id": session_id, "messages": messages}

    return app
