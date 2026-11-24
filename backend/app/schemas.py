from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, field_validator


class ChatRequest(BaseModel):
    session_id: str
    message: str
    system_prompt: str | None = None

    @field_validator("session_id")
    @classmethod
    def _session_id(cls, v: str) -> str:
        v = v.strip()
        if not 1 <= len(v) <= 128:
            raise ValueError("session_id must be 1-128 characters")
        return v

    @field_validator("message")
    @classmethod
    def _message(cls, v: str) -> str:
        v = v.strip()  # the 1-4000 rule applies after trimming
        if not 1 <= len(v) <= 4000:
            raise ValueError("message must be 1-4000 characters after trimming")
        return v

    @field_validator("system_prompt")
    @classmethod
    def _system_prompt(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class Attempt(BaseModel):
    key_id: str
    status: int | None = None


class Metadata(BaseModel):
    resolution_source: Literal["LIVE_INFERENCE", "LLM_CACHE"]
    model: str
    latency_ms: int
    input_tokens: int
    output_tokens: int
    key_id: str | None
    fallback_attempts: int
    # Extra fields, allowed by the contract:
    cache_key: str
    attempts: list[Attempt]


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    metadata: Metadata


class HistoryResponse(BaseModel):
    session_id: str
    messages: list[dict[str, Any]]
