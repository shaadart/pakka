# Pakka

A chatbot backend that keeps answering when an API key fails, and does not pay twice for the same question. FastAPI, LiteLLM and SQLite, with a React frontend.

Status: backend, tests, Docker setup, chat UI and contract checker are built and pass against a real Gemini model locally. Not deployed yet.

## 1. Live URLs

Not deployed yet.

- Frontend: TBD
- Backend: TBD
- Health: `<backend>/health`

## 2. Run locally

### With Docker

```bash
cp .env.example .env        # then put two real keys in LLM_API_KEYS
make up                     # backend :8000, frontend :3000
make test                   # backend tests, inside the image
make verify                 # the assignment's rules, run against the backend (needs Node 18+)
make down
```

The SQLite file lives on the named volume `appdata`, mounted at `/data`, so history survives `make down` and `make up`.

To try it with no keys at all, set `LLM_MOCK_RESPONSE=anything` in `.env`. Every healthy key then answers with that text and no provider is called. Do not set it on a real deployment.

### Without Docker

```bash
cd backend
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
export LLM_API_KEYS=key-one,key-two DATABASE_URL=sqlite:///./app.db ENABLE_FAILURE_SIMULATION=true
.venv/bin/uvicorn app.main:create_app --factory --port 8000 --workers 1
.venv/bin/python -m pytest -q

cd ../frontend && npm ci && npm run dev    # http://localhost:3000
```

Configuration is all environment variables. `.env.example` lists every one.

## 3. Design decisions

### Key fallback

`LLM_API_KEYS` becomes an ordered chain in a LiteLLM `Router`: `key_1`, then `key_2`, and so on. Each key is its own deployment with `model_info.id` set to its key id, so after a call `_hidden_params["model_id"]` says which key answered. The router's `fallbacks` move to the next key on a 429, a quota error, a timeout or a 5xx. If every key fails, LiteLLM raises the last error and the handler returns `503 {"detail": "all providers unavailable"}`. Nothing is written to SQLite in that case.

`X-Simulate-Failure` builds a separate Router for that one request, with LiteLLM's mock error strings on the named keys. The shared Router never sees the drill, so its cooldowns do not leak into real traffic. A drill skips the cache read, otherwise a cached message could never fail. The header is ignored completely unless `ENABLE_FAILURE_SIMULATION=true`.

A provider call that hangs is cut off after `LLM_TIMEOUT_SECONDS` (default 15) and the chain moves to the next key. In testing, one real Gemini call hung until the earlier 30 s limit, so with two keys a user can wait up to twice that before a 503.

Limit: LiteLLM can only raise a rate-limit error (for 429) or an internal-server error (for the rest) from a mock string. A simulated 502 or 503 therefore behaves as a 5xx, and the status you asked for is recorded in `metadata.attempts`.

### Caching

LiteLLM's in-memory `Cache(type="local")`, keyed on the model and the full message list (system prompt, history, new message). The key does not include the API key, so a reply cached through `key_1` serves `key_2` too. A different message, or a different system prompt, is a different key.

The cache is called explicitly instead of through `caching=True`. On LiteLLM 1.110.3 the built-in route writes the cache in the background, so an immediate repeat can miss. The code reads with `async_get_cache` before the Router and awaits `async_add_cache` after it. A startup warm-up pays LiteLLM's one-off import cost, so the first real hit is faster than a live call.

Limits: the cache is in memory, so it is per process, it resets when the container restarts, and the app runs one uvicorn worker on purpose. LiteLLM 1.110.3 has no disk cache type, and the assignment rules out Redis. An exact-match cache is also only safe while answers do not change: in a real shop, a price change would need the cache key to include a knowledge-base version, or a short TTL.

### SQLite session storage

Two tables, created on startup: `messages` (the schema from the assignment) and `sessions` (the per-session system prompt, so the prompt never shows up as a message row). The database is opened with WAL, and each call uses its own short connection off the event loop. A turn is written in one transaction: session, user row, assistant row (with the metadata JSON). A request that fails with a 422 or a 503 writes nothing. A lock per session id keeps two simultaneous messages in the same session in order.

The history sent to the model is read from SQLite on every request. The client sends only the new message.

### Other choices

- Latency is measured around the handler, including the history read, and rounded up, so a cache hit reports at least 1 ms.
- Logs carry session id, source, key id and latency, never message text and never a key.
- Unhandled errors return `{"detail": "internal error"}`, never a stack trace.
- The backend image is multi-stage, runs as a non-root user and has a health check.

## 4. Verification

With the stack running (locally or live):

Easiest: open the frontend and press **Run checks**. It runs 14 checks against the backend from your browser and shows pass or fail for each.

The same checks run from a terminal (they are one file, `frontend/src/inspection/checks.js`, so the two cannot drift):

```bash
make verify URL=https://your-backend          # default http://localhost:8000
make verify ARGS=--no-memory                  # when the backend is using LLM_MOCK_RESPONSE
```

Each run makes about five live model calls. It exits non-zero if any check fails.

By hand:

```bash
B=http://localhost:8000
# per-message tokens and source
curl -s $B/chat -H 'content-type: application/json' -d '{"session_id":"s-1","message":"What is the capital of France?"}' | jq .metadata
# the same message, new session: LLM_CACHE, same reply, key_id null, faster
curl -s $B/chat -H 'content-type: application/json' -d '{"session_id":"s-2","message":"What is the capital of France?"}' | jq .metadata
# failover: key_1 fails, key_2 answers
curl -s $B/chat -H 'content-type: application/json' -H 'X-Simulate-Failure: key_1=429' -d '{"session_id":"s-3","message":"hello"}' | jq .metadata
# every key fails: 503, and the session does not exist afterwards
curl -s -i $B/chat -H 'content-type: application/json' -H 'X-Simulate-Failure: *=429' -d '{"session_id":"s-4","message":"hello"}'
curl -s -i $B/sessions/s-4/messages
```

What has been checked: the backend test suite (37 tests, mock provider) and `make verify` (14 of 14 checks) against a real Gemini model, `gemini/gemini-3.5-flash-lite`, with two keys. That run showed a live answer with real token counts, a cache hit at 1 ms against a live call of about 1.2 s, failover through the header, and multi-turn memory.

What has not: a real 429 or quota error from Google. Failover is exercised through `X-Simulate-Failure`, which uses LiteLLM's mock errors, so Router cooldown after a real rate limit is unverified. Both keys in that run belonged to one account, so the quota was shared.

## 5. Setup Used

- Editor: VS Code

## 6. Bonus features

- **Receipts.** Under each reply: source, model, which key answered, latency and tokens. A failed key shows as a struck-through VOID line, a cache hit says no key was used and that its usage is stored from the first live call, and a 503 prints a VOID receipt that says nothing was saved. The aim is to make the invisible parts (failover, cache, storage) visible to whoever is testing.
- **The barcode is the cache key.** The bars are drawn from `metadata.cache_key`. The same first message in a new session prints the identical barcode, stamped "On the shelf". Hovering one lights up every receipt with the same key.
- **History panel.** Shows the live result of `GET /sessions/{id}/messages` for the current session, including the 404 before the first reply, with a raw JSON toggle.
- **Simulate failure chips.** One chip per key cycles through ok, 429, 500, 502 and 503 and shows the `X-Simulate-Failure` value that will be sent, with a Reset chip. Shown only when `/health` reports `simulation_enabled`.
- **Run checks / `make verify`.** The 14 contract checks, in the page and in the terminal.
- **Extra fields,** allowed by the contract: `metadata.cache_key` and `metadata.attempts` on `/chat`; `simulation_enabled` and `model` on `/health`.

UI limits: the session id is generated on every page load, so a reload starts a new session by design. A message sent while every key is failing keeps its bubble, marked "not saved". No cost in rupees is shown, because no price is verified for the model in use.
