// The saved history of the current session, read live from GET /sessions/{id}/messages.
export default function Ledger({ sessionId, result, raw, onRaw, onClose, className, inert }) {
  const status = result ? result.status : null;
  const messages = status === 200 ? result.body.messages : [];
  const replies = messages.filter((m) => m.metadata);
  // A cache hit repeats the first call's token counts but bills nothing, so totals count live replies only.
  const live = replies.filter((m) => m.metadata.resolution_source !== "LLM_CACHE");
  const tokensIn = live.reduce((n, m) => n + m.metadata.input_tokens, 0);
  const tokensOut = live.reduce((n, m) => n + m.metadata.output_tokens, 0);
  const endpoint = `GET /sessions/${sessionId}/messages`;

  return (
    <aside className={`ledger ${className || ""}`} aria-labelledby="ledger-title" inert={inert}>
      <header>
        <div className="hrow">
          <h2 id="ledger-title">History</h2>
          <div className="tools">
            <div className="seg" role="group" aria-label="View">
              <button className="chip" type="button" aria-pressed={!raw} onClick={() => onRaw(false)}>Rows</button>
              <button className="chip" type="button" aria-pressed={raw} onClick={() => onRaw(true)}>JSON</button>
            </div>
            <button className="btn close" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="call">What the server saved for session {sessionId}</div>
      </header>
      <div className="body">
        {status === null && <p className="empty">Loading...</p>}
        {status === 404 && <p className="empty">Nothing saved yet. The server keeps a session once its first reply is saved.</p>}
        {status === 0 && <p className="empty">The backend did not answer.</p>}
        {status === 200 && raw && <pre>{JSON.stringify(result.body, null, 2)}</pre>}
        {status === 200 && !raw && (
          <ol className="rows">
            {messages.map((m, i) => (
              <li key={i}>
                <div>
                  <div className="role">{m.role === "user" ? "You" : "Reply"}</div>
                  <div className="txt">{m.content}</div>
                  {m.metadata && (
                    <div className="meta">
                      {m.metadata.resolution_source === "LLM_CACHE"
                        ? "From cache · 0 tokens billed"
                        : `Live · ${m.metadata.input_tokens} in / ${m.metadata.output_tokens} out · ${m.metadata.key_id}`}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <footer>
        <div>{messages.length} rows · {replies.length - live.length} from cache · billed <b>{tokensIn} in / {tokensOut} out</b> tokens</div>
        <div>The system prompt is saved but not listed.</div>
        <div className="endpoint">{endpoint} · {status ?? "..."}</div>
      </footer>
    </aside>
  );
}
