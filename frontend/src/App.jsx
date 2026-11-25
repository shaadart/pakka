import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getHealth, getHistory, postChat } from "./api.js";
import { Slip, VoidSlip } from "./components/Slip.jsx";
import Ledger from "./components/Ledger.jsx";
import Inspection from "./components/Inspection.jsx";
import Logo from "./components/Logo.jsx";
import Rig from "./components/Rig.jsx";
import Composer, { SAMPLES } from "./components/Composer.jsx";

const SID_KEY = "pakka.lastSession";
const newSessionId = () => "s-" + Math.random().toString(16).slice(2, 10);
const clock = () => new Date().toTimeString().slice(0, 8);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Storage can throw (private mode). Losing the "previous session" link is the only cost.
const readLastSession = () => { try { return localStorage.getItem(SID_KEY); } catch { return null; } };
const saveLastSession = (id) => { try { localStorage.setItem(SID_KEY, id); } catch { /* see above */ } };

// X-Simulate-Failure value for the drill, or null when every key is healthy.
export function drillHeader(drill, keyIds) {
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

// For each slip, the other slip that printed the same cache key (prefer the earliest one).
function findTwins(feed) {
  const first = new Map();
  const twins = new Map();
  for (const item of feed) {
    if (item.type !== "slip" || !item.meta.cache_key) continue;
    const seen = first.get(item.meta.cache_key);
    if (!seen) { first.set(item.meta.cache_key, item); continue; }
    twins.set(item.id, seen);
    if (!twins.has(seen.id)) twins.set(seen.id, item);
  }
  return twins;
}

const Feed = memo(function Feed({ feed, sessionId, flashId, onJump, onRetry }) {
  const twins = findTwins(feed);
  return feed.map((item) => {
    switch (item.type) {
      case "divider":
        return <div key={item.id} className="divider" role="separator">{item.text}</div>;
      case "user":
        return (
          <div key={item.id} className={`user${item.unsaved ? " unsaved" : ""}`}>
            <div className="bubble">{item.text}</div>
            {item.unsaved && (
              <span className="tag">
                Not saved
                {item.sid === sessionId && <button className="btn" type="button" onClick={() => onRetry(item)}>Retry</button>}
              </span>
            )}
          </div>
        );
      case "pending":
        return (
          <div key={item.id} className="slipwrap">
            <article className="slip printing" aria-label="Printing the receipt"><div className="reply">printing...</div></article>
          </div>
        );
      case "slip": {
        const twin = twins.get(item.id);
        return (
          <div key={item.id} id={`slip-${item.id}`} className={flashId === item.id ? "flash" : undefined}>
            <Slip
              reply={item.reply}
              meta={item.meta}
              number={item.number}
              time={item.time}
              past={item.past}
              twin={twin && { id: twin.id, number: twin.number, sameSession: twin.sid === item.sid }}
              onJump={onJump}
            />
          </div>
        );
      }
      case "void":
        return <div key={item.id}><VoidSlip detail={item.detail} time={item.time} /></div>;
      default:
        return <div key={item.id} className="notice" role="alert">{item.text}</div>;
    }
  });
});

export default function App() {
  const [previous] = useState(readLastSession); // read before this load's new id overwrites it
  const [prevRows, setPrevRows] = useState(null);
  const [sessionId, setSessionId] = useState(newSessionId); // the contract: a new session on every page load
  const sidRef = useRef(sessionId);
  const [feed, setFeed] = useState([]);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [health, setHealth] = useState({ state: "checking", data: null });
  const [drill, setDrill] = useState({});
  const [ledger, setLedger] = useState(null);
  const [rawLedger, setRawLedger] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [rigOpen, setRigOpen] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [flashId, setFlashId] = useState(null);
  const [announce, setAnnounce] = useState("");
  const [newBelow, setNewBelow] = useState(false);
  const feedRef = useRef(null);
  const atBottom = useRef(true);
  const nextId = useRef(1);
  const receipts = useRef(0); // numbered per session
  const historyBtn = useRef(null);
  const ledgerWasOpen = useRef(false);

  const keyIds = health.data && health.data.simulation_enabled
    ? Array.from({ length: health.data.keys_configured }, (_, i) => `key_${i + 1}`)
    : [];
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
  const healthState = useRef("checking");
  healthState.current = health.state;
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
    // Re-check every 30 s, so a backend that dies later does not keep showing Online.
    const timer = setInterval(async () => {
      if (document.hidden || healthState.current !== "open") return;
      const res = await getHealth();
      if (!aliveRef.current) return;
      if (res.status === 200) setHealth({ state: "open", data: res.body });
      else checkHealth();
    }, 30000);
    return () => { aliveRef.current = false; clearInterval(timer); };
  }, [checkHealth]);

  const loadLedger = useCallback(async (id) => {
    const res = await getHistory(id);
    if (sidRef.current === id) setLedger(res);
  }, []);
  useEffect(() => { saveLastSession(sessionId); loadLedger(sessionId); }, [sessionId, loadLedger]);

  // Offer the session from before the reload, read-only. It is never sent back to the model.
  useEffect(() => {
    if (!previous) return;
    getHistory(previous).then((res) => {
      if (res.status === 200 && res.body.messages.length) setPrevRows(res.body.messages);
    });
  }, [previous]);
  function showPrevious() {
    const items = [{ type: "divider", text: `Earlier session ${previous}. Shown for reference; this chat does not remember it.` }];
    let n = 0;
    for (const m of prevRows) {
      if (m.role === "user") items.push({ type: "user", text: m.content, sid: previous, past: true });
      else if (m.metadata) items.push({ type: "slip", reply: m.content, meta: m.metadata, number: ++n, sid: previous, time: "earlier", past: true });
    }
    items.push({ type: "divider", text: `This session ${sidRef.current}` });
    setFeed((f) => [...items.map((i) => ({ id: nextId.current++, ...i })), ...f]);
    setPrevRows(null);
  }

  // Follow new messages only when the reader is already at the bottom, or just sent something.
  useLayoutEffect(() => {
    const el = feedRef.current;
    const last = feed[feed.length - 1];
    if (atBottom.current || (last && (last.type === "user" || last.type === "pending"))) {
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
      setNewBelow(false);
    } else if (last) {
      setNewBelow(true);
    }
  }, [feed]);
  function onFeedScroll() {
    const el = feedRef.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setNewBelow(false);
  }
  function toBottom() {
    const el = feedRef.current;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewBelow(false);
  }

  // Mobile History drawer: focus moves in, Esc closes it, focus returns to the History button.
  useEffect(() => {
    if (ledgerOpen) {
      document.querySelector(".ledger .close")?.focus();
      const onKey = (e) => { if (e.key === "Escape") setLedgerOpen(false); };
      document.addEventListener("keydown", onKey);
      ledgerWasOpen.current = true;
      return () => document.removeEventListener("keydown", onKey);
    }
    if (ledgerWasOpen.current) historyBtn.current?.focus();
    ledgerWasOpen.current = false;
  }, [ledgerOpen]);
  // The drawer only exists below 1000px. Close it on widening so the inert chat does not stay locked.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1001px)");
    const onChange = () => { if (mq.matches) setLedgerOpen(false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const jumpTo = useCallback((id) => {
    document.getElementById(`slip-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
    setTimeout(() => setFlashId(null), 1800);
  }, []);

  function startSession() {
    const id = newSessionId();
    sidRef.current = id;
    receipts.current = 0;
    setSessionId(id);
    setLedger(null);
    add({ type: "divider", text: `New session ${id}. History starts empty.` });
    return id;
  }

  // Returns text to put back in the box when the server refused it as too long.
  async function send(raw, { fresh = false } = {}) {
    if (pending) return;
    const session = fresh ? startSession() : sidRef.current;
    const trimmed = raw.trim();
    setPending(true);
    const userId = trimmed ? add({ type: "user", text: trimmed, sid: session }) : null;
    const pendingId = trimmed ? add({ type: "pending", sid: session }) : null;

    const payload = { session_id: session, message: raw };
    if (systemPrompt.trim()) payload.system_prompt = systemPrompt.trim();
    const res = await postChat(payload, header);

    if (pendingId) drop(pendingId);
    const time = clock();
    let giveBack = null;
    if (res.status === 200) {
      const hit = res.body.metadata.resolution_source === "LLM_CACHE";
      receipts.current += 1;
      setAnnounce(`Reply from ${hit ? "the cache" : "the live model"}, ${res.body.metadata.latency_ms} ms: ${res.body.reply}`);
      add({ type: "slip", reply: res.body.reply, meta: res.body.metadata, number: receipts.current, sid: session, time });
    } else if (res.status === 503) {
      if (userId) patch(userId, { unsaved: true });
      setAnnounce("Every key failed. Nothing was answered or saved.");
      add({ type: "void", detail: (res.body && res.body.detail) || "all providers unavailable", sid: session, time });
    } else if (res.status === 422) {
      if (userId) drop(userId);
      if (trimmed.length > 4000) giveBack = raw;
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
    return giveBack;
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  const retry = useCallback((item) => { drop(item.id); sendRef.current(item.text); }, [drop]);

  const signText =
    health.state === "open" ? `Online · ${health.data.keys_configured} keys · cache ${health.data.cache_enabled ? "on" : "off"}`
    : health.state === "closed" ? "Backend not answering"
    : "Waking the backend...";
  // One span per word, keyed by the text: the stagger replays only when the words change, not on every 30 s re-check.
  const sign = signText.split(" ").map((word, i) => (
    <Fragment key={`${signText}:${i}`}>
      {i > 0 && " "}
      <span className="w" style={{ "--i": i }}>{word}</span>
    </Fragment>
  ));
  const locked = ledgerOpen || inspecting; // a drawer or dialog is open: the rest of the page is inert

  return (
    <div className="app">
      <header className="top" inert={locked}>
        <div className="brand">
          <Logo />
          <div>
            <h1>Pakka</h1>
            <p>Every reply, accounted for</p>
          </div>
        </div>
        {health.state === "closed" ? (
          <div className="sign closed" role="status" title="From GET /health">
            <span className="dot" aria-hidden="true" />
            <span>{sign}</span>
            <button className="btn" type="button" onClick={checkHealth}>Retry</button>
          </div>
        ) : (
          <button
            className={`sign ${health.state}`}
            type="button"
            aria-expanded={rigOpen}
            aria-controls="rig"
            title="From GET /health. Tap to open the test rig"
            onClick={() => setRigOpen((o) => !o)}
          >
            <span className="dot" aria-hidden="true" />
            <span role="status">{sign}</span>
          </button>
        )}
        <div className="actions">
          <button className="btn" type="button" onClick={() => startSession()}>New session</button>
          <button ref={historyBtn} className="btn ledger-open" type="button" onClick={() => setLedgerOpen(true)}>History</button>
          <button className={`btn${header ? " alert" : ""}`} type="button" aria-expanded={rigOpen} aria-controls="rig" onClick={() => setRigOpen((o) => !o)}>
            Test rig{header ? " · failures on" : ""}
          </button>
        </div>
      </header>

      {rigOpen && (
        <Rig
          keyIds={keyIds}
          drill={drill}
          setDrill={setDrill}
          header={header}
          systemPrompt={systemPrompt}
          setSystemPrompt={setSystemPrompt}
          onCacheDemo={() => send(SAMPLES[0], { fresh: true })}
          onRunChecks={() => setInspecting(true)}
          pending={pending}
          inert={locked}
        />
      )}

      <main className="layout">
        <section className="chat" inert={locked}>
          <div className="sr-only" aria-live="polite">{announce}</div>
          <div className="feed" ref={feedRef} onScroll={onFeedScroll}>
            {prevRows && (
              <button className="btn prev" type="button" onClick={showPrevious}>
                Show the session from before you reloaded ({prevRows.length} messages)
              </button>
            )}
            {feed.length === 0 && (
              <div className="intro">
                <h2>Ask anything. Get a receipt.</h2>
                <p>Ask about a slot, a price or your name, in any language. Every answer prints a receipt showing where it came from and what it cost.</p>
                <div className="sample" aria-hidden="true">
                  <div className="slip">
                    <div className="reply">Haan ji, kal 11 baje ka slot khaali hai.</div>
                    <div className="lines">
                      <div className="ln"><span className="k">Source · live</span><span className="lead" /><span className="v">LIVE_INFERENCE</span></div>
                      <div className="ln"><span className="k">Latency</span><span className="lead" /><span className="v">840 ms</span></div>
                      <div className="ln"><span className="k">Tokens</span><span className="lead" /><span className="v">36 in · 31 out</span></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <Feed feed={feed} sessionId={sessionId} flashId={flashId} onJump={jumpTo} onRetry={retry} />
          </div>
          {newBelow && <div className="below"><button className="btn" type="button" onClick={toBottom}>New reply below</button></div>}
          <Composer onSend={send} pending={pending} />
          <footer className="credit">
            Made by Shaad · <a href="https://madebyshaad.com" target="_blank" rel="noopener">See more of my work</a>
          </footer>
        </section>

        {ledgerOpen && <div className="scrim" onClick={() => setLedgerOpen(false)} />}
        <Ledger
          className={ledgerOpen ? "open" : ""}
          sessionId={sessionId}
          result={ledger}
          raw={rawLedger}
          onRaw={setRawLedger}
          onClose={() => setLedgerOpen(false)}
          inert={inspecting}
        />
      </main>

      {inspecting && <Inspection onClose={() => { setInspecting(false); loadLedger(sidRef.current); }} />}
    </div>
  );
}
