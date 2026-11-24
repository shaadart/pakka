import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../api.js";
import { runInspection } from "../inspection/checks.js";

// The contract check. It spends real model quota, so nothing runs until Start is pressed.
export default function Inspection({ onClose }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [round, setRound] = useState(0); // 0 = not started
  const firstRef = useRef(null);

  useEffect(() => {
    if (!round) return;
    let alive = true;
    setRows([]);
    setSummary(null);
    runInspection({
      base: API_BASE,
      onResult: (r) => alive && setRows((prev) => [...prev, r]),
    }).then((s) => alive && setSummary(s));
    return () => { alive = false; };
  }, [round]);

  useEffect(() => { firstRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const running = round > 0 && !summary;
  const all = summary && summary.passed === summary.total;
  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="report" role="dialog" aria-modal="true" aria-labelledby="insp-title">
        <div className="slip">
          <h3 id="insp-title">Contract check</h3>
          <div className="sub">The assignment's 14 rules, run from this page against {API_BASE}</div>
          {round === 0 ? (
            <p className="warn">This makes about five live model calls, which use real API quota. Nothing runs until you press Start.</p>
          ) : (
            <ol className="checks" aria-live="polite">
              {rows.map((r) => (
                <li key={r.n}>
                  <span className="n">{String(r.n).padStart(2, "0")}</span>
                  <span className={r.ok ? "pass" : "fail"}>{r.ok ? "PASS" : "FAIL"}</span>
                  <span className="d">{r.name}<small>{r.detail}</small></span>
                </li>
              ))}
              {running && <li className="running"><span className="n" /><span /><span className="d">Running...</span></li>}
            </ol>
          )}
          <div className="total">
            {summary ? (
              <div className={`stamp ${all ? "" : "void"}`}>{all ? "Pass" : "Fail"} {summary.passed}/{summary.total}</div>
            ) : (
              <div className="progress">{round ? `${rows.length} checks done` : "14 checks"}</div>
            )}
            <div className="buttons">
              <button className="btn primary" type="button" ref={firstRef} disabled={running} onClick={() => setRound((n) => n + 1)}>
                {round === 0 ? "Start" : "Run again"}
              </button>
              <button className="btn" type="button" onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
