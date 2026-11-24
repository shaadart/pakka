"""All configuration comes from environment variables. See .env.example."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful assistant for a small business. "
    "Answer in the language the customer writes in. Keep replies short and kind."
)


class ConfigError(RuntimeError):
    pass


def _csv(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def _flag(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def sqlite_path(database_url: str) -> str:
    """`sqlite:////data/app.db` -> `/data/app.db`, `sqlite:///./app.db` -> `./app.db`."""
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        raise ConfigError(f"DATABASE_URL must start with {prefix!r}, got {database_url!r}")
    path = database_url[len(prefix):]
    if not path:
        raise ConfigError("DATABASE_URL has no file path")
    return path


@dataclass(frozen=True)
class Settings:
    api_keys: list[str]
    model: str = "gemini/gemini-3.5-flash-lite"
    database_path: str = "./app.db"
    allowed_origins: list[str] = field(default_factory=lambda: ["http://localhost:3000"])
    enable_failure_simulation: bool = False
    default_system_prompt: str = DEFAULT_SYSTEM_PROMPT
    timeout_seconds: float = 15.0
    # Test and offline-demo switch: every healthy key answers with this text and no
    # provider is called. Never set it on a real deployment.
    mock_response: str | None = None

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        env = dict(os.environ if env is None else env)
        keys = _csv(env.get("LLM_API_KEYS"))
        if not keys:
            raise ConfigError("LLM_API_KEYS is empty. Set at least one key (two or more for failover).")
        return cls(
            api_keys=keys,
            model=env.get("LLM_MODEL", cls.model).strip() or cls.model,
            database_path=sqlite_path(env.get("DATABASE_URL", "sqlite:///./app.db")),
            allowed_origins=_csv(env.get("ALLOWED_ORIGINS")) or ["http://localhost:3000"],
            enable_failure_simulation=_flag(env.get("ENABLE_FAILURE_SIMULATION")),
            default_system_prompt=env.get("DEFAULT_SYSTEM_PROMPT", "").strip() or DEFAULT_SYSTEM_PROMPT,
            timeout_seconds=float(env.get("LLM_TIMEOUT_SECONDS", "15")),
            mock_response=env.get("LLM_MOCK_RESPONSE") or None,
        )

    @property
    def key_ids(self) -> list[str]:
        return [f"key_{i}" for i in range(1, len(self.api_keys) + 1)]
