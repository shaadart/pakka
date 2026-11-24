"""LiteLLM gateway: an ordered key chain (Router + fallbacks) and an explicit response cache.

Two LiteLLM behaviours shape this file (verified on 1.110.3 with mocks, see the repo README):

* `caching=True` writes the cache in the background, so an immediate repeat can miss.
  We call `async_get_cache` before the Router and *await* `async_add_cache` after it.
* The Router deep-copies `model_list`, so failures are simulated with LiteLLM's mock
  strings, not exception objects.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import litellm
from litellm import Router
from litellm.caching.caching import Cache

from .config import Settings
from .simulate import status_for

log = logging.getLogger("pakka.llm")

litellm.suppress_debug_info = True
litellm.telemetry = False

CACHE_HIT = "LLM_CACHE"
LIVE = "LIVE_INFERENCE"


class AllProvidersDown(Exception):
    """Every key failed, or the model returned nothing usable."""


@dataclass
class Answer:
    reply: str
    resolution_source: str
    model: str
    key_id: str | None
    fallback_attempts: int
    input_tokens: int
    output_tokens: int
    cache_key: str
    attempts: list[dict[str, Any]] = field(default_factory=list)


def _mock_error(status: int) -> str:
    # LiteLLM only raises for these two mock strings. 502 and 503 are simulated as a
    # provider 5xx; the status the caller asked for is kept in `attempts`.
    return "litellm.RateLimitError" if status == 429 else "litellm.InternalServerError"


def _get(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _text_and_usage(resp: Any) -> tuple[str, int, int]:
    choice = _get(resp, "choices")[0]
    text = _get(_get(choice, "message"), "content") or ""
    usage = _get(resp, "usage") or {}
    return text.strip(), int(_get(usage, "prompt_tokens", 0) or 0), int(_get(usage, "completion_tokens", 0) or 0)


class Gateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model = settings.model
        self.key_ids = settings.key_ids
        self.cache = Cache(type="local")  # in memory: one process, so one uvicorn worker
        self.router = self._build_router(None)

    def _build_router(self, sim: dict[str, int] | None) -> Router:
        model_list = []
        for key_id, key in zip(self.key_ids, self.settings.api_keys):
            params: dict[str, Any] = {
                "model": self.model,
                "api_key": key,
                "timeout": self.settings.timeout_seconds,
            }
            status = status_for(sim, key_id)
            if status is not None:
                params["mock_response"] = _mock_error(status)
            elif self.settings.mock_response:
                params["mock_response"] = self.settings.mock_response
            model_list.append(
                {"model_name": key_id, "litellm_params": params, "model_info": {"id": key_id}}
            )
        fallbacks = [{self.key_ids[0]: self.key_ids[1:]}] if len(self.key_ids) > 1 else []
        return Router(model_list=model_list, fallbacks=fallbacks, num_retries=0)

    async def warm_up(self) -> None:
        """Pay LiteLLM's one-off import cost at startup, so the first real hit is fast."""
        await self.cache.async_get_cache(
            model=self.model, messages=[{"role": "user", "content": "__warmup__"}]
        )

    def cache_key(self, messages: list[dict[str, str]]) -> str:
        return self.cache.get_cache_key(model=self.model, messages=messages)

    async def answer(self, messages: list[dict[str, str]], sim: dict[str, int] | None) -> Answer:
        key = self.cache_key(messages)

        if sim is None:  # a failure drill never reads the cache, or it could not fail
            hit = await self.cache.async_get_cache(model=self.model, messages=messages)
            if hit:
                text, tokens_in, tokens_out = _text_and_usage(hit)
                if text:
                    return Answer(text, CACHE_HIT, self.model, None, 0, tokens_in, tokens_out, key)

        router = self.router if sim is None else self._build_router(sim)
        try:
            resp = await router.acompletion(model=self.key_ids[0], messages=messages)
        except Exception as exc:  # every provider failed; LiteLLM re-raises the last error
            log.warning("all keys failed: %s", type(exc).__name__)
            raise AllProvidersDown from exc

        text, tokens_in, tokens_out = _text_and_usage(resp)
        if not text:
            raise AllProvidersDown
        key_id = (getattr(resp, "_hidden_params", None) or {}).get("model_id")
        if key_id not in self.key_ids:
            key_id = self.key_ids[0]
        failed = self.key_ids[: self.key_ids.index(key_id)]
        attempts = [{"key_id": k, "status": status_for(sim, k)} for k in failed]

        try:
            await self.cache.async_add_cache(resp, model=self.model, messages=messages)
        except Exception as exc:  # a cache write must never cost the user their answer
            log.warning("cache write failed: %s", type(exc).__name__)

        return Answer(text, LIVE, self.model, key_id, len(failed), tokens_in, tokens_out, key, attempts)
