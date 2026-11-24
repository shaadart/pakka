<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/banner.png">
    <img src="docs/images/banner.png" alt="Pakka. 23:04. Key one died an hour ago. The customer still gets an answer." width="100%">
  </picture>
</p>

23:04. The shop is closed. A customer asks for a morning slot, and `key_1` ran out of quota an hour ago.

**The customer still gets an answer.**

**Pakka** is a chatbot that keeps answering when things break, and prints a receipt under every reply to show you how. In an Indian shop, a *pakka* bill is the proper, printed one.

| When this happens | Pakka does this | The receipt shows |
|---|---|---|
| A key runs out or fails | Asks the next key | `key_1` struck through · *429, skipped* · Key `key_2` |
| The same question comes again | Reuses the saved answer. No new AI cost | `LLM_CACHE` · *From cache* · 0 billed · *Same key as Receipt #0001* |
| Every key fails | Says so in one sentence. Saves nothing | A red VOID slip · *not saved* |
| Any reply | Counts what that one reply used | Latency · input and output tokens |

<p align="center">
  <img src="docs/images/screens/hero.png" alt="Pakka chat. The first answer is LIVE_INFERENCE from key_1 in 997 ms, 38 in and 30 out tokens. The same question in a new session comes back from the cache in 1 ms, 0 billed, with the same barcode and a link to the first receipt. The History panel shows the saved rows." width="100%">
  <br><sub>A real run, nothing simulated: a live answer in 1 s. Asked again in a new session, the same answer came from the cache in 1 ms and billed 0 tokens. Each receipt has a <b>Copy reply</b> link.</sub>
</p>

> **Grading on a clock?** Open the app, open **Test rig** and press **Run checks**, then **Start**. All 14 contract rules run live from your browser.
>
> **Status:** 37/37 backend tests pass · 14/14 live checks pass on `gemini/gemini-3.5-flash-lite` · deployed: [pakka.madebyshaad.com](https://pakka.madebyshaad.com)

<details>
<summary><b>New to these words?</b></summary>

| Word | Meaning |
|---|---|
| **API key** | A password that lets the app use an AI service. Pakka keeps 2 or more |
| **Quota** | How much a key may use. When it's gone, the key stops working for a while |
| **Failover** | Switching to the next key when one fails |
| **Cache** | Saved answers, reused when the exact same question comes again |
| **Tokens** | What an AI service counts and charges for. Input is what you sent, output is what it wrote |
| **Session** | One conversation. The app remembers everything said inside it |
| **LiteLLM** | The library Pakka uses to talk to the AI, switch keys and save answers |
| **SQLite** | A small database in one file. It holds every conversation |
| **`LIVE_INFERENCE` · `LLM_CACHE`** | "The AI wrote this just now" · "This came from saved answers" |
| **422 · 404 · 503** | "Your message was invalid" · "No such conversation" · "Every key failed, try again soon" |

</details>

---

## 1. Live URLs

| | |
|---|---|
| Frontend | https://pakka.madebyshaad.com |
| Backend | https://pakka-api.fly.dev |
| Health | https://pakka-api.fly.dev/health |
| Demo video | TBD |

- `ENABLE_FAILURE_SIMULATION=true` is set in production (`backend/fly.toml`), so `X-Simulate-Failure` works on the live URL and **Run checks** can pass all 14 rules there.
- The cache lives in memory. Fly stops the machine when it has been idle, and it starts again on the next request with an empty cache: the first repeat runs live, the next one hits `LLM_CACHE`. History is safe, because it sits on a volume.
- The first request after an idle period is slower, because the machine has to start.

### Deployment

```mermaid
flowchart LR
    B["Browser"] -->|"static files"| P["Cloudflare Pages<br/>pakka.madebyshaad.com"]
    B -->|"HTTPS, CORS"| F["Fly.io app pakka-api<br/>region sin · 1 machine"]
    F --> V[("Volume data<br/>/data/app.db")]
    F --> G["Gemini via LiteLLM"]
```

| Part | Where | Details |
|---|---|---|
| Frontend | Cloudflare Pages, project `pakka` | Static Vite build. Production branch `main`. Custom domain `pakka.madebyshaad.com` (a `CNAME` to `pakka-7eh.pages.dev`). The API URL is baked in at build time through `VITE_API_BASE_URL` |
| Backend | Fly.io app `pakka-api`, region `sin` | The `runtime` stage of `backend/Dockerfile`. One `shared-cpu-1x` machine with 512 MB. Stops when idle, starts on request. Health check on `/health` |
| Data | Fly volume `data`, 1 GB, mounted at `/data` | Holds the SQLite file `/data/app.db`. A volume belongs to one machine, so the app must stay at **one machine** |
| Secrets | `LLM_API_KEYS` as a Fly secret | Never in git, never in `fly.toml` |
| Config in git | [`backend/fly.toml`](backend/fly.toml) | `DATABASE_URL`, `ALLOWED_ORIGINS` (`https://pakka.madebyshaad.com`, exact), `ENABLE_FAILURE_SIMULATION` |

**CI/CD.** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push to `main` and every pull request. Pushing to `main` also deploys, after all checks pass.

| Job | What it checks |
|---|---|
| Backend tests | `pytest` (37 cases) |
| Frontend build + tests | `vite build`, the Code 128 decode test and the Playwright UI tests at 1440 and 390 px |
| Secret scan | gitleaks over the full git history |
| Static analysis | Semgrep (Python, JavaScript, OWASP top 10, secrets) |
| Dependency audit | `pip-audit`, `npm audit` at high severity, and dependency review on pull requests |
| Image build + scan | hadolint, a build of the backend `runtime` image, Trivy on the image (fixable HIGH and CRITICAL fail) and Trivy on the Dockerfiles and `fly.toml` |
| **CI passed** | One gate over all of the above. This is the only check `main` requires |

After the gate passes on `main`:

1. **Deploy backend:** `flyctl deploy --remote-only` from `backend/`, then a retrying `curl` of `/health`.
2. **Deploy frontend:** builds with `VITE_API_BASE_URL`, runs `wrangler pages deploy dist --project-name pakka --branch main`, then a `curl` of `https://pakka.madebyshaad.com/`.

The frontend goes second, so a new UI never meets an old API. Deploys never cancel each other mid-run. Both deploy jobs use the GitHub environment `production`.

**Branch protection on `main`:** changes go through a pull request, `CI passed` must be green and the branch up to date, history stays linear, and force pushes and deletion are blocked. Dependabot opens weekly update PRs for Actions, pip, npm and Docker. `litellm` is pinned on purpose, so review those bumps by hand.

**Secrets and variables** (GitHub, repo Settings, Environments, `production`):

| Name | Kind | Value |
|---|---|---|
| `FLY_API_TOKEN` | Secret | `fly tokens create deploy -a pakka-api` |
| `CLOUDFLARE_API_TOKEN` | Secret | A token with only **Cloudflare Pages: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | From the Cloudflare dashboard |
| `API_URL` | Variable, optional | Backend URL for the build and smoke test. Defaults to `https://pakka-api.fly.dev` |

<details>
<summary><b>First-time setup</b></summary>

```bash
# Backend (log in to the Fly account that should own the app)
fly auth login
cd backend
fly launch --no-deploy --copy-config --org personal   # use your org slug
fly volumes create data --size 1 --region sin         # same region as fly.toml
fly secrets set LLM_API_KEYS="key1,key2"
fly deploy

# Frontend
cd ../frontend
VITE_API_BASE_URL=https://pakka-api.fly.dev npm run build
npx wrangler pages deploy dist --project-name pakka --branch main
```

Then in Cloudflare: Workers & Pages, `pakka`, Custom domains, add `pakka.madebyshaad.com`. If a Worker already owns that hostname, remove it from the Worker's domains first.

</details>

<details>
<summary><b>Manual deploy, rollback, checks</b></summary>

```bash
# Redeploy the backend by hand
(cd backend && fly deploy --remote-only)

# Roll back the backend
fly releases -a pakka-api                 # list versions
fly deploy -a pakka-api --image <image from an older release>

# Roll back the frontend: Cloudflare, Workers & Pages, pakka, Deployments,
# open an older production deployment, Rollback to this deployment.
# Or revert the commit through a pull request and let the pipeline redeploy.

# Check the live stack
curl https://pakka-api.fly.dev/health
make verify URL=https://pakka-api.fly.dev
```

- Fly takes daily snapshots of the volume. Restore from one with `fly volumes snapshots list` and `fly volumes create --snapshot-id`.
- Never scale past one machine: a second machine would get its own empty volume and its own cache.
- A change to `ALLOWED_ORIGINS` or the frontend domain needs a backend deploy, or the browser will fail on CORS.

</details>

---

## 2. Run locally: with Docker and without

```bash
cp .env.example .env     # put 2+ real keys in LLM_API_KEYS
make up                  # backend :8000 · frontend :3000
make test                # 37 pytest cases inside the image
make verify              # 14 live contract checks (Node 18+)
(cd frontend && npm test)          # UI: barcode decodes + 17 Playwright tests at 1440 and 390 px, mocked backend
(cd frontend && npm run test:live) # the same UI against the real stack from make up
make down
```

- History lives on the named volume `appdata`, at `/data/app.db`. It survives `make down` and restarts.
- **No keys?** Set `LLM_MOCK_RESPONSE=anything` in `.env`. Failover, caching and SQLite still behave for real. Run `make verify ARGS=--no-memory`, since a fixed reply can't remember your name.

<details>
<summary><b>Without Docker</b></summary>

```bash
cd backend
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
export LLM_API_KEYS=key-one,key-two DATABASE_URL=sqlite:///./app.db ENABLE_FAILURE_SIMULATION=true
.venv/bin/uvicorn app.main:create_app --factory --port 8000 --workers 1

cd ../frontend && npm ci && npm run dev   # http://localhost:3000
```

</details>

<details>
<summary><b>Environment variables</b></summary>

| Variable | Meaning |
|---|---|
| `LLM_API_KEYS` | Comma-separated key pool (2+). Mapped to `key_1`, `key_2`, ... in order |
| `DATABASE_URL` | SQLite path, e.g. `sqlite:////data/app.db` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins, exact scheme and host |
| `ENABLE_FAILURE_SIMULATION` | `true` enables the `X-Simulate-Failure` header (default `false`) |
| `LLM_MODEL` | LiteLLM model id (default `gemini/gemini-3.5-flash-lite`) |
| `DEFAULT_SYSTEM_PROMPT` | Used when a session sets no `system_prompt` |
| `LLM_TIMEOUT_SECONDS` | How long one key gets before the next (default `15`) |
| `LLM_MOCK_RESPONSE` | Offline test reply. Leave unset on a real deployment |
| `VITE_API_BASE_URL` | Frontend build arg: where the browser finds the backend (default `http://localhost:8000`) |

Point every key at the same model. The cache key is the model plus the messages, never the key, so an answer from `key_1` stays right for `key_2`.

</details>

---

## 3. Design decisions: key fallback, caching, SQLite session storage

```mermaid
flowchart LR
    A["POST /chat"] --> C{"In cache?"}
    C -- yes --> H["LLM_CACHE"]
    C -- no --> R["key_1 → key_2 → ..."]
    R -- answered --> W["LIVE_INFERENCE<br/>await cache write"]
    R -- all failed --> E["503<br/>zero DB writes"]
    H --> T["SQLite<br/>1 transaction"]
    W --> T
```

**First, what LiteLLM actually does.** It was new to me, so I tested `1.110.3` in small scripts before building on it. 4 surprises shaped everything below:

1. **`caching=True` writes in the background.** An immediate repeat can miss.
2. **There's no disk cache in `1.110.3`.** With Redis ruled out, in-memory is the only option.
3. **Only 2 mock errors raise.** `litellm.ServiceUnavailableError` comes back as reply text, inside a 200.
4. **`Router` deep-copies `model_list`.** Exception objects crash on copy.

### Key fallback

> The keys wait in a line. If one fails, the next one answers.

**How**
- One LiteLLM `Router`, 1 deployment per key (`model_info.id = key_id`), chained `key_1` → `key_2` → ... with `num_retries=0`.
- `key_1` always goes first, so `fallback_attempts` is the answering key's place in line.
- The answering key comes from `_hidden_params["model_id"]`. The key itself never appears in a response or a log.
- The line moves on after a 429, a quota error, a 5xx, a timeout or an empty answer.
- Every key failed? `503 {"detail": "all providers unavailable"}`.

**Testing it on demand**
- A request with `X-Simulate-Failure` gets its own short-lived `Router`, with the named keys set to fail.
- It skips the cache, so the failure really happens. The real fallback code runs, and fake failures never touch real traffic.

**Where it stops**
- `502` and `503` drills run as LiteLLM's `500` mock (surprise 3). The status you asked for is kept in `metadata.attempts`.
- 2 hung keys at a 15 s timeout can hold a request for 30 s before the `503`.

### Caching

> The same question, in the same context, gets the saved answer. No AI call, no cost.

**How**
- LiteLLM's `Cache(type="local")`, called by hand: read before the `Router`, then **await `async_add_cache`** after a live answer (surprise 1). That's what makes an immediate repeat in a new session return `LLM_CACHE`.
- The key is `model` + the full message list: system prompt, history, new message. Change 1 word and it misses.
- A warm-up read at startup pays LiteLLM's one-off import cost, so the first real hit stays around `1 ms`.
- A failed cache write is logged and skipped. The user still gets their answer.

**Where it stops**
- Memory dies on restart, so `uvicorn` runs **1 worker, on purpose**. A 2nd worker would hold a 2nd, empty cache.
- An exact-match cache assumes answers don't change. A shop that changes its hours would add a catalog version to the key, or a TTL.

### SQLite session storage

> A conversation is saved only after its answer arrives. A failure leaves no trace.

**How**
- The contract's `messages` table, plus an index on `(session_id, id)`.
- A small `sessions` table holds each session's `system_prompt`, so it never shows up in `GET /sessions/{session_id}/messages`.
- The browser sends only the new message. The server rebuilds the conversation from SQLite on every call.
- A finished turn commits in **1 transaction**: session, user row, assistant row. A `422` or `503` writes nothing.
- A per-session `asyncio.Lock` keeps 2 fast messages in order. WAL mode, off the event loop via `asyncio.to_thread`.

---

## 4. Verification: how to see failover, cache hits and per-message token usage

> A renamed field counts as a missing requirement. So the contract checks itself.

Open **Test rig** and press **Run checks**, or:

```bash
make verify URL=https://your-backend
```

Both run one file, [`checks.js`](frontend/src/inspection/checks.js), so they can't drift apart. About 5 live AI calls, 14 checks:

| Area | Checks |
|---|---|
| Health | `/health` is up, 2+ keys, cache on |
| Bad input | 4 kinds refused with `422` |
| Cache | A fresh question is live. The same one in a new session comes from the cache |
| Failover | `key_1` fails with `429`, then `500`: `key_2` answers both times |
| Outage | Every key fails: `503`, and the session was never saved (`404`) |
| History | Oldest first, and the bot remembers earlier messages |
| Secrets | No key appears in any response |

**See it yourself, in 30 seconds:**

| To see | Do this | Look for on the receipt |
|---|---|---|
| **Tokens per message** | Send any question | The `Tokens` line: input and output for that one turn |
| **A cache hit** | Ask *Kal 11 baje slot milega?*, then in **Test rig** click **Same question, new session** | `LLM_CACHE`, blue **From cache** stamp, ~`1 ms`, *0 billed*, the same barcode and a *Same key as Receipt #0001* link |
| **Failover** | In **Test rig**, set `key_1` to `429`, then send | `key_1` struck through, *429, skipped*, Key `key_2` |
| **Every key down** | In **Test rig**, set every key to `429`, then send | Red **VOID** slip, *Not saved* with **Retry**, **History** still `404` |

<table>
  <tr>
    <td width="50%"><img src="docs/images/screens/failover.png" alt="Test rig open with key_1 set to 429. The X-Simulate-Failure header reads key_1=429. The receipt shows key_1 struck through, 429 skipped, and key_2 answered."></td>
    <td width="50%"><img src="docs/images/screens/void.png" alt="Every key set to 503. The message bubble is dashed and marked Not saved, with a Retry button. A red VOID slip says every key failed and nothing was saved. History still lists only the earlier two rows."></td>
  </tr>
  <tr>
    <td><sub><b>Failover.</b> <code>key_1</code> pretends <code>429</code>, so <code>key_2</code> answers. The receipt keeps the skipped key.</sub></td>
    <td><sub><b>Every key down.</b> A readable <code>503</code>, <i>Not saved</i> with <b>Retry</b>, and History unchanged.</sub></td>
  </tr>
</table>

**Reading a receipt:**

<table>
  <tr>
    <td width="55%"><img src="docs/images/screens/receipt.png" alt="A cache-hit receipt. Reply text, Receipt #0001 with a From cache stamp, then Source LLM_CACHE, Model gemini/gemini-3.5-flash-lite, Key none used, Latency 1 ms, Tokens 0 billed, first call 36 in 27 out, a barcode, the cache key 91f5 5820 07e5 f3b0 and a link Same key as Receipt #0001, earlier session. A Copy reply link sits beside the time."></td>
    <td>

| Line | Means |
|---|---|
| **Source** | `LIVE_INFERENCE` or `LLM_CACHE`, exactly as the API sent it |
| **Model** | The model that wrote it |
| **Key** | Which key answered. Failed keys print above it, struck through |
| **Latency** | Time for this reply |
| **Tokens** | What this reply used. A cache hit bills 0 and shows the first call's counts |
| **Barcode** | Real Code 128 of the cache key. Scan it and you get the printed text |
| **Copy reply** | Puts the reply text on your clipboard, without the receipt |

</td>
  </tr>
</table>

<details>
<summary><b>The same, with curl</b></summary>

```bash
B=http://localhost:8000; J='content-type: application/json'

curl -s $B/chat -H "$J" -d '{"session_id":"s-1","message":"What is the capital of France?"}' | jq .metadata
curl -s $B/chat -H "$J" -d '{"session_id":"s-2","message":"What is the capital of France?"}' | jq .metadata   # LLM_CACHE
curl -s $B/chat -H "$J" -H 'X-Simulate-Failure: key_1=429' -d '{"session_id":"s-3","message":"hi"}' | jq .metadata   # key_2
curl -s -i $B/chat -H "$J" -H 'X-Simulate-Failure: *=429' -d '{"session_id":"s-4","message":"hi"}'   # 503
curl -s -i $B/sessions/s-4/messages   # 404: the failed turn left no rows
curl -s $B/sessions/s-1/messages | jq
```

</details>

| ✓ Proven | ✗ Not yet |
|---|---|
| 37 pytest cases on LiteLLM mocks | A real `429` from Google |
| 14/14 live checks on `gemini-3.5-flash-lite` | `Router` cooldown after a real rate limit |
| Live ~1.2 s vs cached 1 ms, real token counts, memory | Two separate quotas: both test keys shared 1 account |

---

## 5. Setup Used

- **Editor:** VS Code
- **AI tools:** Claude Code and Antigravity, for scaffolding, contract tests and README polish. I read, ran and fixed every generated file before keeping it.
- **By hand:** spike scripts against LiteLLM `1.110.3` before writing the gateway, then live contract checks against Gemini.

---

## 6. Bonus features (if any)

> Everything graded here happens out of sight. So I put it on paper.

| Addition | Why it's there |
|---|---|
| **Thermal receipts** | Source, key chain, latency and tokens, readable at a glance |
| **Cache-key barcode** | A real Code 128 of the first 16 hex characters of `metadata.cache_key`, so a scanner reads what is printed under it. A *Same key as Receipt #…* link jumps to the matching receipt |
| **Test rig** | The operator tools, kept out of the chat: pick `ok · 429 · 500 · 502 · 503` per key and see the exact header (only when `/health` reports `simulation_enabled`), the cache demo, the system prompt and Run checks |
| **VOID slip + History drawer** | A readable `503`, next to live `GET /sessions/{id}/messages` proving the failed turn is still `404` |
| **Run checks (14/14)** | The grader's checklist, run by the app itself. It asks before spending the ~5 model calls |

<p align="center">
  <img src="docs/images/screens/mobile.png" alt="Four phone screens at 390 px wide: the empty start screen with a sample receipt, a chat with a cache-hit receipt, the Test rig with key_1 set to 429, and the History drawer." width="100%">
  <br><sub>At 390 px: the first screen, a cache hit, the Test rig, the History drawer.</sub>
</p>

- **Extras are fields only:** `cache_key` and `attempts` on `/chat`, `simulation_enabled` and `model` on `/health`. No new endpoints.
- **Remove every shop word** from the UI, and every path, field and `data-testid` still meets the spec.
- **No rupee cost on the receipt.** I haven't verified this model's price, and I won't print a number I can't stand behind.

---

<p align="center"><i>At 11 PM, a customer doesn't care which key ran out. Only that someone answered.</i></p>
