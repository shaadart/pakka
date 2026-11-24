import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

REPLY = "The capital of France is Paris."


def make_settings(tmp_path, **overrides) -> Settings:
    base = dict(
        api_keys=["fake-key-one", "fake-key-two"],
        model="gemini/gemini-2.0-flash",
        database_path=str(tmp_path / "app.db"),
        allowed_origins=["http://localhost:3000"],
        enable_failure_simulation=True,
        mock_response=REPLY,  # LiteLLM mock: no provider is ever called in tests
    )
    base.update(overrides)
    return Settings(**base)


@pytest.fixture
def make_client(tmp_path):
    clients = []

    def _make(**overrides):
        cm = TestClient(create_app(make_settings(tmp_path, **overrides)), raise_server_exceptions=False)
        clients.append(cm)
        return cm.__enter__()

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client):
    return make_client()


def chat(client, session_id, message, headers=None, **extra):
    return client.post("/chat", json={"session_id": session_id, "message": message, **extra}, headers=headers or {})
