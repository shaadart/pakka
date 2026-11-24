// The live result of GET /sessions/{id}/messages for the current session.
export default function Ledger({ sessionId, result, raw, onToggleRaw, onClose, className }) {
  const status = result ? result.status : null;
  const messages = result && result.status === 200 ? result.body.messages : [];
  const replies = messages.filter((m) => m.metadata);
  const tokensIn = replies.reduce((n, m) => n + m.metadata.input_tokens, 0);
  const tokensOut = replies.reduce((n, m) => n + m.metadata.output_tokens, 0);
  const fromShelf = replies.filter((m) => m.metadata.resolution_source === "LLM_CACHE").length;

  return (
    <aside className={`ledger ${className || ""}`} aria-label="History">
      <header>
        <h2>
          History
          <span className="tools">
            <button className="mini" type="button" onClick={onToggleRaw}>{raw ? "Rows" : "Raw JSON"}</button>
            <button className="mini close" type="button" onClick={onClose}>Close</button>
          </span>
        </h2>
        <div className="call">GET /sessions/{sessionId}/messages · <span className="st">{status ?? "loading"}</span></div>
      </header>
      <div className="body">
        {status === 404 && (
          <p className="empty">No rows yet. This endpoint answers 404 "session not found" until the first reply is saved.</p>
        )}
        {status === 0 && <p className="empty">The backend did not answer.</p>}
        {status === 200 && raw && <pre>{JSON.stringify(result.body, null, 2)}</pre>}
        {status === 200 && !raw && (
          <ol className="rows">
            {messages.map((m, i) => (
              <li key={i}>
                <div>
                  <div className="role">{m.role}</div>
                  <div className="txt">{m.content}</div>
                  {m.metadata && (
                    <div className="meta">
                      {m.metadata.resolution_source} · {m.metadata.input_tokens} in / {m.metadata.output_tokens} out
                      {m.metadata.key_id ? ` · ${m.metadata.key_id}` : ""}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <footer>
        <div>Rows <b>{messages.length}</b> · replies from cache <b>{fromShelf}</b></div>
        <div>This session <b>{tokensIn} in / {tokensOut} out</b> tokens</div>
        <div>Stored in SQLite. The system prompt is kept off this list.</div>
      </footer>
    </aside>
  );
}
