import { useState } from "react";
import Barcode from "./Barcode.jsx";

function Line({ k, children, tone, title }) {
  return (
    <div className={`ln${tone ? " " + tone : ""}`}>
      <span className="k">{k}</span>
      <span className="lead" aria-hidden="true" />
      <span className={`v${title ? " clip" : ""}`} title={title}>{children}</span>
    </div>
  );
}

function VoidLine({ keyId, status }) {
  return (
    <Line k={<s>{keyId}</s>} tone="void">
      {status ?? "failed"}, skipped
    </Line>
  );
}

// Copies the reply text only. Clipboard access can be refused, so say so instead of failing silently.
function CopyReply({ text }) {
  const [state, setState] = useState("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1800);
  }
  return (
    <button type="button" className="copy" onClick={copy}>
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : "Copy reply"}
    </button>
  );
}

const receiptNo = (n) => `Receipt #${String(n).padStart(4, "0")}`;

// One assistant reply with its receipt. The data-testids follow the assignment's UI contract.
// A slip from an earlier session (past) drops them, so the contract only ever sees this session's replies.
export function Slip({ reply, meta, number, time, past, twin, onJump }) {
  const hit = meta.resolution_source === "LLM_CACHE";
  const id = (name) => (past ? undefined : name);
  const key = meta.cache_key ? meta.cache_key.slice(0, 16) : "";
  return (
    <div className="slipwrap">
      <article className="slip" data-testid={id("assistant-message")}>
        <div className="reply">{reply}</div>
        <div className="head">
          <span className="who">
            {receiptNo(number)}
            {hit && <span className="stamp">From cache</span>}
          </span>
          <span className="when">{time}<CopyReply text={reply} /></span>
        </div>
        <div className="lines">
          <Line k={hit ? "Source · cache" : "Source · live"}><span data-testid={id("meta-source")}>{meta.resolution_source}</span></Line>
          <Line k="Model" title={meta.model}><span data-testid={id("meta-model")}>{meta.model}</span></Line>
          {(meta.attempts || []).map((a, i) => <VoidLine key={i} keyId={a.key_id} status={a.status} />)}
          <Line k="Key">{hit ? "none used" : meta.key_id}</Line>
          <Line k="Latency"><span data-testid={id("meta-latency")}>{meta.latency_ms} ms</span></Line>
          <Line k="Tokens" tone={hit ? "soft" : undefined}>
            {hit && "0 billed · first call "}
            <span data-testid={id("meta-input-tokens")}>{meta.input_tokens}</span> in ·{" "}
            <span data-testid={id("meta-output-tokens")}>{meta.output_tokens}</span> out
          </Line>
        </div>
        {key && (
          <div className="code">
            <Barcode text={key} />
            <div className="hex">
              <span>{key.match(/.{4}/g).join(" ")}</span>
              {twin ? (
                <button type="button" className="twin" onClick={() => onJump(twin.id)}>
                  Same key as {receiptNo(twin.number)}{twin.sameSession ? "" : ", earlier session"}
                </button>
              ) : (
                <span>cache key</span>
              )}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}

// A 503: every key failed. Nothing was answered and nothing was stored.
export function VoidSlip({ detail, time }) {
  return (
    <div className="slipwrap">
      <article className="slip isvoid">
        <div className="reply">Every key failed, so nothing was answered and nothing was saved. Try again in a minute.</div>
        <div className="head">
          <span className="who">No receipt<span className="stamp void">Void</span></span>
          <span>{time}</span>
        </div>
        <div className="lines">
          <Line k="Status">503</Line>
          <Line k="Saved" tone="soft">no</Line>
          <Line k="Server said" tone="soft">{detail}</Line>
        </div>
      </article>
    </div>
  );
}
