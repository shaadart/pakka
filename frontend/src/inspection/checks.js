// The assignment contract as 14 checks over plain fetch.
// One file, two runners: the "Run inspection" button in the page, and `make verify` (Node).
// Each run makes about five live model calls: one answer, two failover answers, two for memory.

const KEY_PATTERN = /AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}/;

export async function runInspection({ base, onResult = () => {}, memory = true, fetchImpl = globalThis.fetch }) {
  const root = base.replace(/\/$/, "");
  const nonce = Math.random().toString(36).slice(2, 8);
  const seen = []; // every response body, scanned for key material at the end
  const results = [];

  async function http(method, path, { body, raw, headers } = {}) {
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const init = { method, headers: { ...(payload === undefined ? {} : { "content-type": "application/json" }), ...headers }, body: payload };
    let res;
    try {
      res = await fetchImpl(root + path, init);
    } catch (err) {
      return { status: 0, json: null, text: String(err && err.message ? err.message : err) };
    }
    const text = await res.text();
    seen.push(text);
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  }
  const chat = (session_id, message, simulate) =>
    http("POST", "/chat", { body: { session_id, message }, headers: simulate ? { "X-Simulate-Failure": simulate } : {} });
  const sid = (tag) => `insp-${nonce}-${tag}`;

  async function step(name, fn) {
    let outcome;
    try {
      outcome = await fn();
    } catch (err) {
      outcome = { ok: false, detail: `threw ${err && err.message ? err.message : err}` };
    }
    const row = { n: results.length + 1, name, ok: !!outcome.ok, detail: outcome.detail };
    results.push(row);
    onResult(row);
  }

  const health = await http("GET", "/health");
  await step("GET /health", async () => {
    const h = health.json || {};
    return {
      ok: health.status === 200 && h.status === "ok" && h.keys_configured >= 2 && h.cache_enabled === true,
      detail: `${health.status} · ${h.keys_configured} keys · cache ${h.cache_enabled ? "on" : "off"}`,
    };
  });

  const bad = [
    ["POST /chat · blank message", { body: { session_id: sid("v"), message: "   " } }],
    ["POST /chat · 4001-character message", { body: { session_id: sid("v"), message: "a".repeat(4001) } }],
    ["POST /chat · 129-character session_id", { body: { session_id: "s".repeat(129), message: "hi" } }],
    ["POST /chat · malformed JSON", { raw: '{"session_id": "x", "message": ' }],
  ];
  for (const [name, init] of bad) {
    await step(name, async () => {
      const r = await http("POST", "/chat", init);
      return { ok: r.status === 422 && r.json && r.json.detail !== undefined, detail: `${r.status} · detail present` };
    });
  }

  const question = `Inspection ${nonce}: clinic ka timing kya hai?`;
  let live = null;
  await step("Live answer", async () => {
    live = await chat(sid("live"), question);
    const m = (live.json && live.json.metadata) || {};
    return {
      ok: live.status === 200 && m.resolution_source === "LIVE_INFERENCE" && m.key_id === "key_1" && m.fallback_attempts === 0
        && m.input_tokens > 0 && m.output_tokens > 0 && !!live.json.reply,
      detail: live.status === 200
        ? `${m.model} · ${m.key_id} · ${m.latency_ms} ms · ${m.input_tokens} in / ${m.output_tokens} out`
        : `${live.status} ${live.text.slice(0, 80)}`,
    };
  });

  await step("Same message, new session", async () => {
    const r = await chat(sid("hit"), question);
    const m = (r.json && r.json.metadata) || {};
    const lm = (live && live.json && live.json.metadata) || {};
    return {
      ok: r.status === 200 && m.resolution_source === "LLM_CACHE" && r.json.reply === (live.json && live.json.reply)
        && m.key_id === null && m.fallback_attempts === 0 && m.latency_ms < lm.latency_ms
        && m.input_tokens === lm.input_tokens && m.output_tokens === lm.output_tokens,
      detail: r.status === 200
        ? `${m.resolution_source} · same reply · key_id ${m.key_id} · ${m.latency_ms} ms against ${lm.latency_ms} ms live`
        : `${r.status} ${r.text.slice(0, 80)}`,
    };
  });

  const sim = health.json && health.json.simulation_enabled === true;
  const noSim = "backend reports simulation_enabled false; set ENABLE_FAILURE_SIMULATION=true";
  for (const status of [429, 500]) {
    await step(`X-Simulate-Failure: key_1=${status}`, async () => {
      if (!sim) return { ok: false, detail: noSim };
      const r = await chat(sid(`d${status}`), `Inspection ${nonce} drill ${status}`, `key_1=${status}`);
      const m = (r.json && r.json.metadata) || {};
      return {
        ok: r.status === 200 && m.key_id === "key_2" && m.fallback_attempts === 1 && !!r.json.reply,
        detail: `${r.status} · answered by ${m.key_id} · fallback_attempts ${m.fallback_attempts}`,
      };
    });
  }
  await step("X-Simulate-Failure: *=429", async () => {
    if (!sim) return { ok: false, detail: noSim };
    const r = await chat(sid("down"), `Inspection ${nonce} all down`, "*=429");
    return { ok: r.status === 503 && r.json && r.json.detail === "all providers unavailable", detail: `${r.status} · ${r.json && r.json.detail}` };
  });
  await step("That 503 was not stored", async () => {
    const r = await http("GET", `/sessions/${sid("down")}/messages`);
    return { ok: r.status === 404 && r.json && r.json.detail === "session not found", detail: `${r.status} · ${r.json && r.json.detail}` };
  });

  await step("GET /sessions/{id}/messages", async () => {
    const r = await http("GET", `/sessions/${sid("live")}/messages`);
    const msgs = (r.json && r.json.messages) || [];
    const [u, a] = msgs;
    const ok = r.status === 200 && msgs.length === 2 && u.role === "user" && a.role === "assistant"
      && !("metadata" in u) && !!a.metadata && "resolution_source" in a.metadata
      && "input_tokens" in a.metadata && "output_tokens" in a.metadata && !msgs.some((m) => m.role === "system");
    return { ok, detail: `${r.status} · ${msgs.length} rows · oldest first · metadata on the assistant row · no system prompt` };
  });

  if (memory) {
    await step("Multi-turn memory", async () => {
      const word = `Zorblax${Math.floor(Math.random() * 9000 + 1000)}`;
      await chat(sid("mem"), `Mera naam ${word} hai. Yaad rakhna.`);
      const r = await chat(sid("mem"), "Mera naam kya hai?");
      const reply = (r.json && r.json.reply) || "";
      return { ok: r.status === 200 && reply.includes(word), detail: `asked for the name, got: ${reply.slice(0, 90)}` };
    });
  }

  await step("No key material in any response", async () => ({
    ok: !seen.some((t) => KEY_PATTERN.test(t)),
    detail: "only key ids (key_1, key_2) leave the server",
  }));

  const passed = results.filter((r) => r.ok).length;
  return { passed, total: results.length, results };
}
