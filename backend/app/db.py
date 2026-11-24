"""SQLite storage. Plain sqlite3, one short-lived connection per call, run off the event loop.

`messages` follows the contract's schema. `sessions` is an extra table that holds the
per-session system prompt, so the prompt never appears as a message row.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id    TEXT PRIMARY KEY,
    system_prompt TEXT,
    created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    metadata    TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, id);
"""


@dataclass(frozen=True)
class SessionState:
    exists: bool
    system_prompt: str | None
    history: list[dict[str, str]]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, path: str) -> None:
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    # ---- sync helpers -------------------------------------------------

    def _init(self) -> None:
        parent = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(parent, exist_ok=True)
        conn = self._connect()
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)
            conn.commit()
        finally:
            conn.close()

    def _ping(self) -> None:
        conn = self._connect()
        try:
            conn.execute("SELECT 1 FROM messages LIMIT 1").fetchall()
        finally:
            conn.close()

    def _load(self, session_id: str) -> SessionState:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT system_prompt FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone()
            if row is None:
                return SessionState(False, None, [])
            rows = conn.execute(
                "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id", (session_id,)
            ).fetchall()
            return SessionState(True, row["system_prompt"], [dict(r) for r in rows])
        finally:
            conn.close()

    def _save_turn(
        self,
        session_id: str,
        system_prompt: str | None,
        user_content: str,
        assistant_content: str,
        metadata: dict[str, Any],
    ) -> None:
        conn = self._connect()
        try:
            with conn:  # one transaction: all three writes land together or not at all
                conn.execute(
                    "INSERT INTO sessions (session_id, system_prompt, created_at) VALUES (?, ?, ?) "
                    "ON CONFLICT(session_id) DO UPDATE SET "
                    "system_prompt = COALESCE(excluded.system_prompt, sessions.system_prompt)",
                    (session_id, system_prompt, _now()),
                )
                conn.execute(
                    "INSERT INTO messages (session_id, role, content, metadata, created_at) "
                    "VALUES (?, 'user', ?, NULL, ?)",
                    (session_id, user_content, _now()),
                )
                conn.execute(
                    "INSERT INTO messages (session_id, role, content, metadata, created_at) "
                    "VALUES (?, 'assistant', ?, ?, ?)",
                    (session_id, assistant_content, json.dumps(metadata), _now()),
                )
        finally:
            conn.close()

    def _messages(self, session_id: str) -> list[dict[str, Any]] | None:
        conn = self._connect()
        try:
            if conn.execute(
                "SELECT 1 FROM sessions WHERE session_id = ?", (session_id,)
            ).fetchone() is None:
                return None
            rows = conn.execute(
                "SELECT role, content, metadata FROM messages WHERE session_id = ? ORDER BY id",
                (session_id,),
            ).fetchall()
        finally:
            conn.close()
        out: list[dict[str, Any]] = []
        for r in rows:
            item: dict[str, Any] = {"role": r["role"], "content": r["content"]}
            if r["metadata"]:
                item["metadata"] = json.loads(r["metadata"])
            out.append(item)
        return out

    # ---- async API ----------------------------------------------------

    async def init(self) -> None:
        await asyncio.to_thread(self._init)

    async def ping(self) -> None:
        await asyncio.to_thread(self._ping)

    async def load_session(self, session_id: str) -> SessionState:
        return await asyncio.to_thread(self._load, session_id)

    async def save_turn(self, *args: Any) -> None:
        await asyncio.to_thread(self._save_turn, *args)

    async def messages(self, session_id: str) -> list[dict[str, Any]] | None:
        return await asyncio.to_thread(self._messages, session_id)
