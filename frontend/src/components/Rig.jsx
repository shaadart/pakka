const STEPS = ["ok", "429", "500", "502", "503"];

// The operator's tools, kept out of the customer chat: failure drill, cache demo, system prompt, contract check.
export default function Rig({ keyIds, drill, setDrill, header, systemPrompt, setSystemPrompt, onCacheDemo, onRunChecks, pending, inert }) {
  return (
    <section className="rig" id="rig" aria-label="Test rig" inert={inert}>
      {keyIds.length > 0 && (
        <div className="rig-group">
          <h2>Simulate key failures</h2>
          <p>Your next messages pretend these keys return the chosen status.</p>
          {keyIds.map((k) => {
            const state = drill[k] || "ok";
            return (
              <div key={k} className="seg" role="group" aria-label={`${k} status`}>
                <span className="seg-label">{k}</span>
                {STEPS.map((s) => (
                  <button key={s} type="button" className="chip" aria-pressed={state === s} onClick={() => setDrill((d) => ({ ...d, [k]: s }))}>
                    {s}
                  </button>
                ))}
              </div>
            );
          })}
          <div className="rig-row">
            <button className="btn" type="button" disabled={!header} onClick={() => setDrill({})}>Reset all to ok</button>
            <code>{header ? `X-Simulate-Failure: ${header}` : "No failure header sent"}</code>
          </div>
        </div>
      )}
      <div className="rig-group">
        <h2>Cache</h2>
        <p>Asks the first sample question again in a fresh session. It should come back from the cache.</p>
        <button className="btn" type="button" disabled={pending} onClick={onCacheDemo}>Same question, new session</button>
      </div>
      <div className="rig-group">
        <h2><label htmlFor="system-prompt">System prompt</label></h2>
        <p>Optional. Overrides the default instructions for this session.</p>
        <textarea
          id="system-prompt"
          data-testid="system-prompt-input"
          rows={2}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>
      <div className="rig-group">
        <h2>Contract check</h2>
        <p>Runs the assignment's 14 rules against the backend. Asks before it spends quota.</p>
        <button className="btn" type="button" onClick={onRunChecks}>Run checks</button>
      </div>
    </section>
  );
}
