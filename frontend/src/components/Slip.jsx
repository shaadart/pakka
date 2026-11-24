import Barcode from "./Barcode.jsx";

const group = (hex) => hex.slice(0, 16).match(/.{1,4}/g).join(" ");

function Line({ k, v, testid, tone }) {
  return (
    <div className={`ln${tone ? " " + tone : ""}`}>
      <span className="k">{k}</span>
      <span className="lead" aria-hidden="true" />
      <span className="v" data-testid={testid}>{v}</span>
    </div>
  );
}

function VoidLine({ keyId, status }) {
  return (
    <div className="ln void">
      <span className="k">{keyId}</span>
      <span className="lead" aria-hidden="true" />
      <span className="v"><s>{status ?? "failed"}</s> VOID</span>
    </div>
  );
}

// One assistant reply with its receipt. The data-testids follow the assignment's UI contract.
export function Slip({ reply, meta, number, sessionId, time, matched, onHoverKey }) {
  const hit = meta.resolution_source === "LLM_CACHE";
  return (
    <div className="slipwrap">
      <article className={`slip${matched ? " match" : ""}`} data-testid="assistant-message">
        <div className="reply">{reply}</div>
        <div className="head">
          <span className="who">
            Receipt #{String(number).padStart(4, "0")}
            {hit && <span className="stamp inline shelf">From cache</span>}
          </span>
          <span className="sid">{sessionId} · {time}</span>
        </div>
        <div className="lines">
          <Line k="Source" v={meta.resolution_source} testid="meta-source" />
          <Line k="Model" v={meta.model} testid="meta-model" />
          {(meta.attempts || []).map((a) => <VoidLine key={a.key_id} keyId={a.key_id} status={a.status} />)}
          <Line k="Answered by" v={hit ? "cache, no key used" : meta.key_id} />
          <Line k="Latency" v={`${meta.latency_ms} ms`} testid="meta-latency" />
          <Line k="Input tokens" v={meta.input_tokens} testid="meta-input-tokens" />
          <Line k="Output tokens" v={meta.output_tokens} testid="meta-output-tokens" />
          {hit && <Line k="Usage" v="stored from the first live call" tone="soft" />}
        </div>
        {meta.cache_key && (
          <div
            className="code"
            onMouseEnter={() => onHoverKey(meta.cache_key)}
            onMouseLeave={() => onHoverKey(null)}
            title="Cache key. Equal barcodes mean the same model and the same full message list."
          >
            <Barcode hex={meta.cache_key} />
            <div className="hex"><span>{group(meta.cache_key)}</span><span>cache key</span></div>
          </div>
        )}
      </article>
    </div>
  );
}

// A 503: every key failed. Nothing was answered and nothing was stored.
export function VoidSlip({ detail, sessionId, time }) {
  return (
    <div className="slipwrap">
      <article className="slip isvoid" role="alert">
        <div className="reply">Every key failed, so nothing was answered and nothing was saved. Try again in a minute.</div>
        <div className="head">
          <span className="who">No receipt<span className="stamp inline void">Void</span></span>
          <span className="sid">{sessionId} · {time}</span>
        </div>
        <div className="lines">
          <Line k="Status" v="503" />
          <Line k="Saved" v="no" tone="soft" />
          <Line k="Server said" v={detail} tone="soft" />
        </div>
      </article>
    </div>
  );
}
