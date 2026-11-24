import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getHealth, getHistory, postChat } from "./api.js";
import { Slip, VoidSlip } from "./components/Slip.jsx";
import Ledger from "./components/Ledger.jsx";
import Inspection from "./components/Inspection.jsx";
import Logo from "./components/Logo.jsx";

const FIRST_QUESTION = "Kal 11 baje slot milega?";
const DRILL_STEPS = ["ok", "429", "500", "502", "503"];
const newSessionId = () => "s-" + Math.random().toString(16).slice(2, 10);
const clock = () => new Date().toTimeString().slice(0, 8);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// X-Simulate-Failure value for the drill chips, or null when every key is healthy.
function drillHeader(drill, keyIds) {
  const failing = keyIds.filter((k) => drill[k] && drill[k] !== "ok");
  if (!failing.length) return null;
  if (failing.length === keyIds.length && failing.every((k) => drill[k] === drill[failing[0]])) return `*=${drill[failing[0]]}`;
  return failing.map((k) => `${k}=${drill[k]}`).join(",");
}

function friendly422(body) {
  const loc = body && Array.isArray(body.detail) && body.detail[0] && body.detail[0].loc;
  const field = loc ? loc[loc.length - 1] : "";
  if (field === "session_id") return "The session id is not valid, so nothing was sent. Reload the page to start a new session.";
  return "A message needs 1 to 4000 characters. Nothing was sent to the model or saved.";
}

export default function App() {
  const [sessionId, setSessionId] = useState(newSessionId); // a new session on every page load
  const sidRef = useRef(sessionId);
  const [feed, setFeed] = useState([]);
  const [text, setText] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [health, setHealth] = useState({ state: "checking", data: null });
  const [drill, setDrill] = useState({});
  const [ledger, setLedger] = useState(null);
  const [rawLedger, setRawLedger] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [hoverKey, setHoverKey] = useState(null);
  const feedRef = useRef(null);
  const inputRef = useRef(null);
  const nextId = useRef(1);
  const receipts = useRef(0);

  const keyIds = health.data ? Array.from({ length: health.data.keys_configured }, (_, i) => `key_${i + 1}`) : [];
  const header = drillHeader(drill, keyIds);

  const add = useCallback((item) => {
    const id = nextId.current++;
    setFeed((f) => [...f, { id, ...item }]);
    return id;
  }, []);
  const patch = useCallback((id, change) => setFeed((f) => f.map((x) => (x.id === id ? { ...x, ...change } : x))), []);
  const drop = useCallback((id) => setFeed((f) => f.filter((x) => x.id !== id)), []);

  // The status sign. A sleeping free-tier host can take a while, so retry before saying closed.
  const aliveRef = useRef(true);
  const checkHealth = useCallback(async () => {
    setHealth((h) => ({ ...h, state: "waking" }));
    for (const pause of [0, 1500, 3000, 6000]) {
      if (pause) await wait(pause);
      const res = await getHealth();
      if (!aliveRef.current) return;
      if (res.status === 200) return setHealth({ state: "open", data: res.body });
    }
    setHealth((h) => ({ ...h, state: "closed" }));
  }, []);
  useEffect(() => {
    aliveRef.current = true;
    checkHealth();
    return () => { aliveRef.current = false; };
  }, [checkHealth]);

  const loadLedger = useCallback(async (id) => {
    const res = await getHistory(id);
    if (sidRef.current === id) setLedger(res);
  }, []);
  useEffect(() => { loadLedger(sessionId); }, [sessionId, loadLedger]);

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  function startSession() {
    const id = newSessionId();
    sidRef.current = id;
    setSessionId(id);
    setLedger(null);
    add({ type: "divider", text: `New session ${id}. History starts empty.` });
    return id;
  }

  async function send(raw, { fresh = false } = {}) {
    if (pending) return;
    const session = fresh ? startSession() : sidRef.current;
    const trimmed = raw.trim();
    setText("");
    setPending(true);
    const userId = trimmed ? add({ type: "user", text: trimmed, sid: session }) : null;
    const pendingId = trimmed ? add({ type: "pending", sid: session }) : null;

    const payload = { session_id: session, message: raw };
    if (systemPrompt.trim()) payload.system_prompt = systemPrompt.trim();
    const res = await postChat(payload, header);

    if (pendingId) drop(pendingId);
    const time = clock();
    if (res.status === 200) {
      receipts.current += 1;
      add({ type: "slip", reply: res.body.reply, meta: res.body.metadata, number: receipts.current, sid: session, time });
    } else if (res.status === 503) {
      if (userId) patch(userId, { unsaved: true });
      add({ type: "void", detail: (res.body && res.body.detail) || "all providers unavailable", sid: session, time });
    } else if (res.status === 422) {
      if (userId) drop(userId);
      if (raw.length > 4000) setText(raw); // give a too-long message back so it can be trimmed
      add({ type: "notice", text: friendly422(res.body), sid: session });
    } else if (res.status === 0) {
      if (userId) patch(userId, { unsaved: true });
      add({ type: "notice", text: "The backend did not answer, so nothing was saved. Check that it is running and try again.", sid: session });
    } else {
      if (userId) patch(userId, { unsaved: true });
      add({ type: "notice", text: `The server returned ${res.status} and nothing was saved. Try again.`, sid: session });
    }
    setPending(false);
    loadLedger(session);
    if (inputRef.current) inputRef.current.focus();
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(text);
    }
  }

  const sign =
    health.state === "open" ? (
      <>Online · <b>{health.data.keys_configured}</b> keys · cache {health.data.cache_enabled ? "on" : "off"}</>
    ) : health.state === "closed" ? (
      <>Backend not answering</>
    ) : (
      <>Waking the backend...</>
    );
  const showDrill = health.data && health.data.simulation_enabled && keyIds.length > 0;
  const over = text.trim().length > 4000;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <Logo />
          <div>
            <h1>Pakka</h1>
            <p>Every reply, accounted for</p>
          </div>
        </div>
        <div className={`sign ${health.state}`} title="From GET /health">
          {sign}
          {health.state === "closed" && <button className="mini" type="button" onClick={checkHealth}>Retry</button>}
        </div>
        {showDrill && (
          <div className="drill">
            <span className="lbl">Simulate failure</span>
            {keyIds.map((k) => {
              const state = drill[k] || "ok";
              return (
                <button
                  key={k}
                  type="button"
                  className="chip"
                  data-state={state}
                  onClick={() => setDrill((d) => ({ ...d, [k]: DRILL_STEPS[(DRILL_STEPS.indexOf(state) + 1) % DRILL_STEPS.length] }))}
                  aria-label={`${k}: ${state === "ok" ? "healthy" : "simulated " + state}. Click to cycle ok, 429, 500, 502, 503.`}
                >
                  {k}: {state}
                </button>
              );
            })}
            {header && <button className="chip reset" type="button" onClick={() => setDrill({})}>Reset</button>}
            <code>{header ? `X-Simulate-Failure: ${header}` : "Click a key to cycle ok, 429, 500, 502, 503"}</code>
          </div>
        )}
        <div className="actions">
          <button className="btn" type="button" onClick={() => startSession()}>New session</button>
          <button className="btn ledger-open" type="button" onClick={() => setLedgerOpen(true)}>History</button>
          <button className="btn" type="button" onClick={() => setInspecting(true)}>Run checks</button>
        </div>
      </header>

      <main className="layout">
        <section className="chat">
          <div className="feed" ref={feedRef} aria-live="polite" aria-busy={pending}>
            {feed.length === 0 && (
              <div className="intro">
                <h2>Ask the front desk.</h2>
                <p>
                  Ask anything, in any language. Under each reply you will see where it came from (live model or cache),
                  which key answered, how long it took and how many tokens it used.
                </p>
              </div>
            )}
            {feed.map((item) => {
              const past = item.sid && item.sid !== sessionId ? " past" : "";
              switch (item.type) {
                case "divider":
                  return <div key={item.id} className="divider">{item.text}</div>;
                case "user":
                  return (
                    <div key={item.id} className={`user${item.unsaved ? " unsaved" : ""}${past}`}>
                      <div className="bubble">{item.text}</div>
                      {item.unsaved && <span className="tag">not saved</span>}
                    </div>
                  );
                case "pending":
                  return (
                    <div key={item.id} className="slipwrap">
                      <article className="slip printing" aria-label="Printing the receipt"><div className="reply">printing...</div></article>
                    </div>
                  );
                case "slip":
                  return (
                    <div key={item.id} className={past.trim()}>
                      <Slip
                        reply={item.reply}
                        meta={item.meta}
                        number={item.number}
                        sessionId={item.sid}
                        time={item.time}
                        matched={!!hoverKey && item.meta.cache_key === hoverKey}
                        onHoverKey={setHoverKey}
                      />
                    </div>
                  );
                case "void":
                  return <div key={item.id} className={past.trim()}><VoidSlip detail={item.detail} sessionId={item.sid} time={item.time} /></div>;
                default:
                  return <div key={item.id} className="notice" role="alert">{item.text}</div>;
              }
            })}
          </div>

          <div className="composer-wrap">
            <div className="tries">
              <span className="lbl">Try</span>
              <button className="try" type="button" onClick={() => send(FIRST_QUESTION)} disabled={pending}>{FIRST_QUESTION}</button>
              <button className="try" type="button" onClick={() => send(FIRST_QUESTION, { fresh: true })} disabled={pending}>Same question, new session</button>
              <button className="try" type="button" onClick={() => send("Mera naam Asha hai")} disabled={pending}>Mera naam Asha hai</button>
              <button className="try" type="button" onClick={() => send("Mera naam kya hai?")} disabled={pending}>Mera naam kya hai?</button>
            </div>
            <details className="sys">
              <summary>System prompt (optional)</summary>
              <textarea
                id="system-prompt"
                data-testid="system-prompt-input"
                rows={2}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Optional. Overrides the default instructions for this session."
                aria-label="System prompt"
              />
            </details>
            <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
              <textarea
                id="message"
                ref={inputRef}
                data-testid="chat-input"
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type a message. Enter sends, Shift+Enter adds a line."
                aria-label="Message"
              />
              <button className="send" type="submit" data-testid="send-button" disabled={pending}>Send</button>
            </form>
            <div className={`count${over ? " over" : ""}`}>{text.trim().length} / 4000</div>
          </div>
        </section>

        <Ledger
          className={ledgerOpen ? "open" : ""}
          sessionId={sessionId}
          result={ledger}
          raw={rawLedger}
          onToggleRaw={() => setRawLedger((r) => !r)}
          onClose={() => setLedgerOpen(false)}
        />
      </main>

      {inspecting && <Inspection onClose={() => { setInspecting(false); loadLedger(sidRef.current); }} />}
    </div>
  );
}
