// A stand-in for the Pakka backend, served through page.route, so UI tests are exact and free.
// It mirrors the real contract: /health, /chat (cache, failover, 503, 422) and /sessions/{id}/messages.
import { createHash } from "node:crypto";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export async function mockApi(page, { keys = 2, delayMs = 0 } = {}) {
  const state = { sessions: new Map(), cache: new Map(), chats: [], healthUp: true, delayMs };
  const json = (route, status, body) => route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("http://api.test/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });

    if (path === "/health") {
      return state.healthUp
        ? json(route, 200, { status: "ok", keys_configured: keys, cache_enabled: true, simulation_enabled: true, model: "gemini/test-model" })
        : json(route, 500, { detail: "down" });
    }

    const hist = path.match(/^\/sessions\/([^/]+)\/messages$/);
    if (hist) {
      const sid = decodeURIComponent(hist[1]);
      const rows = state.sessions.get(sid);
      return rows ? json(route, 200, { session_id: sid, messages: rows }) : json(route, 404, { detail: "session not found" });
    }

    if (path === "/chat") {
      const body = req.postDataJSON();
      const sim = req.headers()["x-simulate-failure"] || null;
      state.chats.push({ body, sim });
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      const message = (body.message || "").trim();
      if (message.length < 1 || message.length > 4000) {
        return json(route, 422, { detail: [{ loc: ["body", "message"], msg: "message must be 1-4000 characters after trimming" }] });
      }
      const failing = parseSim(sim, keys);
      const healthy = Array.from({ length: keys }, (_, i) => `key_${i + 1}`).filter((k) => !failing[k]);
      const history = state.sessions.get(body.session_id) || [];
      const cacheKey = createHash("sha256").update(JSON.stringify([body.system_prompt || "", ...history.map((m) => m.content), message])).digest("hex");
      const cached = sim ? null : state.cache.get(cacheKey); // like the real gateway: a drill never reads the cache
      let metadata;
      let reply;
      if (cached) {
        reply = cached.reply;
        metadata = { ...cached.metadata, resolution_source: "LLM_CACHE", latency_ms: 1, key_id: null, fallback_attempts: 0, attempts: [] };
      } else {
        if (!healthy.length) return json(route, 503, { detail: "all providers unavailable" });
        const attempts = Object.entries(failing).map(([key_id, status]) => ({ key_id, status }));
        reply = `Reply to: ${message}`;
        metadata = {
          resolution_source: "LIVE_INFERENCE", model: "gemini/test-model", latency_ms: 812,
          input_tokens: 36, output_tokens: 31, key_id: healthy[0], fallback_attempts: attempts.length,
          cache_key: cacheKey, attempts,
        };
        state.cache.set(cacheKey, { reply, metadata });
      }
      state.sessions.set(body.session_id, [...history, { role: "user", content: message }, { role: "assistant", content: reply, metadata }]);
      return json(route, 200, { session_id: body.session_id, reply, metadata });
    }
    return json(route, 404, { detail: "not found" });
  });
  return state;
}

// "key_1=429,key_2=500" or "*=503" -> { key_1: 429, ... }
function parseSim(sim, keys) {
  const out = {};
  for (const part of (sim || "").split(",").filter(Boolean)) {
    const [k, v] = part.split("=");
    const ids = k === "*" ? Array.from({ length: keys }, (_, i) => `key_${i + 1}`) : [k];
    for (const id of ids) out[id] = Number(v);
  }
  return out;
}
