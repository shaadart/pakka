"""One test per row of the assignment contract (sections 3 and 4)."""

import json

import pytest

from conftest import REPLY, chat

META_FIELDS = {
    "resolution_source", "model", "latency_ms", "input_tokens", "output_tokens", "key_id", "fallback_attempts",
}


# ---- /health -----------------------------------------------------------------

def test_health_shape(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["keys_configured"] == 2
    assert body["cache_enabled"] is True


# ---- /chat -------------------------------------------------------------------

def test_chat_200_shape(client):
    r = chat(client, "s-1", "What is the capital of France?")
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == "s-1"
    assert body["reply"] == REPLY
    meta = body["metadata"]
    assert META_FIELDS <= meta.keys()
    assert meta["resolution_source"] == "LIVE_INFERENCE"
    assert meta["model"] == "gemini/gemini-2.0-flash"
    assert isinstance(meta["latency_ms"], int) and meta["latency_ms"] >= 1
    assert meta["input_tokens"] > 0 and meta["output_tokens"] > 0
    assert meta["key_id"] == "key_1"
    assert meta["fallback_attempts"] == 0


def test_same_first_message_in_new_session_is_a_cache_hit(client):
    live = chat(client, "s-a", "What is the capital of France?").json()
    hit = chat(client, "s-b", "What is the capital of France?").json()
    assert hit["metadata"]["resolution_source"] == "LLM_CACHE"
    assert hit["reply"] == live["reply"]
    assert hit["metadata"]["key_id"] is None
    assert hit["metadata"]["fallback_attempts"] == 0
    assert hit["metadata"]["input_tokens"] == live["metadata"]["input_tokens"]
    assert hit["metadata"]["output_tokens"] == live["metadata"]["output_tokens"]
    assert hit["metadata"]["latency_ms"] < live["metadata"]["latency_ms"]
    assert hit["metadata"]["cache_key"] == live["metadata"]["cache_key"]


def test_a_different_message_is_never_cached(client):
    chat(client, "s-a", "What is the capital of France?")
    other = chat(client, "s-b", "What is the capital of Spain?").json()
    assert other["metadata"]["resolution_source"] == "LIVE_INFERENCE"


def test_a_different_system_prompt_is_never_cached(client):
    chat(client, "s-a", "hello")
    other = chat(client, "s-b", "hello", system_prompt="Answer only in French.").json()
    assert other["metadata"]["resolution_source"] == "LIVE_INFERENCE"


def test_tokens_are_per_request_not_a_running_total(client):
    first = chat(client, "s-a", "tell me one thing").json()["metadata"]
    second = chat(client, "s-b", "tell me one thing").json()["metadata"]  # cache, same usage
    third = chat(client, "s-c", "tell me two thing").json()["metadata"]  # same length, new session
    assert first["input_tokens"] == second["input_tokens"] == third["input_tokens"]
    # We report the provider's usage for this call only, so a later turn is never a sum.
    # (LiteLLM's mock always reports 10 in / 20 out, so growth with history cannot be
    # asserted here. Check it against a real key with scripts/verify.sh.)
    later = chat(client, "s-a", "and another one").json()["metadata"]
    assert later["input_tokens"] == first["input_tokens"]
    assert later["output_tokens"] == first["output_tokens"]


# ---- failover ----------------------------------------------------------------

@pytest.mark.parametrize("status", [429, 500, 502, 503])
def test_key_1_failing_falls_back_to_key_2(client, status):
    r = chat(client, f"s-{status}", "hello", headers={"X-Simulate-Failure": f"key_1={status}"})
    assert r.status_code == 200
    meta = r.json()["metadata"]
    assert meta["key_id"] == "key_2"
    assert meta["fallback_attempts"] == 1
    assert meta["attempts"] == [{"key_id": "key_1", "status": status}]
    assert r.json()["reply"] == REPLY  # a real answer, not an error wrapped in a 200


def test_all_keys_failing_is_a_clean_503_and_nothing_is_stored(client):
    r = chat(client, "s-down", "hello", headers={"X-Simulate-Failure": "*=429"})
    assert r.status_code == 503
    assert r.json() == {"detail": "all providers unavailable"}
    assert client.get("/sessions/s-down/messages").status_code == 404


def test_explicit_pairs_for_both_keys_give_503(client):
    r = chat(client, "s-down", "hello", headers={"X-Simulate-Failure": "key_1=429,key_2=500"})
    assert r.status_code == 503


def test_a_failure_drill_skips_the_cache(client):
    chat(client, "s-a", "hello")  # now cached
    r = chat(client, "s-b", "hello", headers={"X-Simulate-Failure": "*=429"})
    assert r.status_code == 503


def test_a_failed_request_does_not_poison_the_session(client):
    chat(client, "s-a", "first")
    chat(client, "s-a", "second", headers={"X-Simulate-Failure": "*=500"})
    msgs = client.get("/sessions/s-a/messages").json()["messages"]
    assert [m["content"] for m in msgs if m["role"] == "user"] == ["first"]


def test_simulation_header_is_ignored_when_switched_off(make_client):
    client = make_client(enable_failure_simulation=False)
    r = chat(client, "s-a", "hello", headers={"X-Simulate-Failure": "*=429"})
    assert r.status_code == 200
    assert r.json()["metadata"]["key_id"] == "key_1"


def test_malformed_simulation_header_is_ignored(client):
    r = chat(client, "s-a", "hello", headers={"X-Simulate-Failure": "banana,key_1=abc,key_1=404"})
    assert r.status_code == 200
    assert r.json()["metadata"]["fallback_attempts"] == 0


# ---- validation --------------------------------------------------------------

@pytest.mark.parametrize(
    "body",
    [
        {"session_id": "s-1"},
        {"message": "hi"},
        {"session_id": "s-1", "message": ""},
        {"session_id": "s-1", "message": "   \n\t "},
        {"session_id": "s-1", "message": "a" * 4001},
        {"session_id": "", "message": "hi"},
        {"session_id": "   ", "message": "hi"},
        {"session_id": "s" * 129, "message": "hi"},
        {"session_id": 7, "message": "hi"},
        {"session_id": "s-1", "message": ["hi"]},
    ],
)
def test_422_cases(client, body):
    r = client.post("/chat", json=body)
    assert r.status_code == 422
    assert "detail" in r.json()


def test_422_on_malformed_json(client):
    r = client.post("/chat", content='{"session_id": "s-1", "message": ', headers={"content-type": "application/json"})
    assert r.status_code == 422
    assert "detail" in r.json()


def test_message_length_limit_counts_after_trimming(client):
    assert chat(client, "s-1", "  " + "a" * 4000 + "  ").status_code == 200
    assert chat(client, "s-2", "a" * 4000).status_code == 200


def test_a_422_adds_nothing_to_history(client):
    client.post("/chat", json={"session_id": "s-bad", "message": ""})
    assert client.get("/sessions/s-bad/messages").status_code == 404


def test_unhandled_error_is_json_not_a_stack_trace(client, monkeypatch):
    async def boom(*_a, **_k):
        raise RuntimeError("secret internals")

    from app import main

    monkeypatch.setattr(main.Database, "load_session", boom)
    r = chat(client, "s-1", "hello")
    assert r.status_code == 500
    assert r.json() == {"detail": "internal error"}
    assert "secret" not in r.text


# ---- sessions and history ----------------------------------------------------

def test_unknown_session_is_404(client):
    r = client.get("/sessions/nope/messages")
    assert r.status_code == 404
    assert r.json() == {"detail": "session not found"}


def test_history_is_oldest_first_without_system_prompt_and_with_metadata(client):
    chat(client, "s-h", "one", system_prompt="Be brief.")
    chat(client, "s-h", "two")
    body = client.get("/sessions/s-h/messages").json()
    assert body["session_id"] == "s-h"
    msgs = body["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert [m["content"] for m in msgs if m["role"] == "user"] == ["one", "two"]
    assert not any(m["role"] == "system" for m in msgs)
    assert "Be brief." not in json.dumps(msgs)
    for m in msgs:
        if m["role"] == "assistant":
            assert {"resolution_source", "input_tokens", "output_tokens"} <= m["metadata"].keys()
        else:
            assert "metadata" not in m


def test_sessions_stay_separate(client):
    chat(client, "s-1", "alpha")
    chat(client, "s-2", "beta")
    one = [m["content"] for m in client.get("/sessions/s-1/messages").json()["messages"] if m["role"] == "user"]
    two = [m["content"] for m in client.get("/sessions/s-2/messages").json()["messages"] if m["role"] == "user"]
    assert one == ["alpha"] and two == ["beta"]


def test_multi_turn_sends_the_whole_history_to_the_model(client, monkeypatch):
    seen = []

    from app import llm

    real = llm.Router.acompletion

    async def spy(self, *args, **kwargs):
        seen.append(kwargs["messages"])
        return await real(self, *args, **kwargs)

    monkeypatch.setattr(llm.Router, "acompletion", spy)
    chat(client, "s-m", "Mera naam Asha hai", system_prompt="Be kind.")
    chat(client, "s-m", "Mera naam kya hai?")
    second = seen[-1]
    assert [m["role"] for m in second] == ["system", "user", "assistant", "user"]
    assert second[0]["content"] == "Be kind."  # the session keeps its system prompt
    assert second[1]["content"] == "Mera naam Asha hai"
    assert second[-1]["content"] == "Mera naam kya hai?"


def test_history_survives_a_restart(make_client, tmp_path):
    first = make_client()
    chat(first, "s-p", "remember me")
    second = make_client()  # same database file, fresh process state
    msgs = second.get("/sessions/s-p/messages").json()["messages"]
    assert msgs[0]["content"] == "remember me"


# ---- privacy, CORS -----------------------------------------------------------

def test_no_key_material_in_any_response(client):
    bodies = [
        client.get("/health").text,
        chat(client, "s-k", "hello").text,
        chat(client, "s-k", "hello", headers={"X-Simulate-Failure": "key_1=429"}).text,
        chat(client, "s-k2", "hello", headers={"X-Simulate-Failure": "*=500"}).text,
        client.get("/sessions/s-k/messages").text,
    ]
    for text in bodies:
        assert "fake-key" not in text


def test_cors_preflight_allows_the_failure_header(client):
    r = client.options(
        "/chat",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-simulate-failure",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "x-simulate-failure" in r.headers["access-control-allow-headers"].lower()
