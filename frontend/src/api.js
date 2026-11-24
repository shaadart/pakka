export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

// Always resolves. status 0 means the backend could not be reached at all.
async function call(method, path, { body, headers } = {}) {
  try {
    const res = await fetch(API_BASE + path, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty or not JSON */ }
    return { status: res.status, body: data };
  } catch {
    return { status: 0, body: null };
  }
}

export const getHealth = () => call("GET", "/health");
export const getHistory = (sessionId) => call("GET", `/sessions/${encodeURIComponent(sessionId)}/messages`);
export const postChat = (payload, simulate) =>
  call("POST", "/chat", { body: payload, headers: simulate ? { "X-Simulate-Failure": simulate } : {} });
