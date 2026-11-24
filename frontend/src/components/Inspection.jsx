import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../api.js";
import { runInspection } from "../inspection/checks.js";

export default function Inspection({ onClose }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [round, setRound] = useState(0);
  const closeRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setRows([]);
    setSummary(null);
    runInspection({
      base: API_BASE,
      onResult: (r) => alive && setRows((prev) => [...prev, r]),
    }).then((s) => alive && setSummary(s));
    return () => { alive = false; };
  }, [round]);

  useEffect(() => { if (closeRef.current) closeRef.current.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const all = summary && summary.passed === summary.total;
  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="report" role="dialog" aria-modal="true" aria-labelledby="insp-title">
        <div className="slip flat">
          <h3 id="insp-title">Contract check</h3>
          <div className="sub">The assignment's rules, run from this page against {API_BASE}</div>
          <ol className="checks" aria-live="polite">
            {rows.map((r) => (
              <li key={r.n}>
                <span className="n">{String(r.n).padStart(2, "0")}</span>
                <span className={r.ok ? "pass" : "fail"}>{r.ok ? "PASS" : "FAIL"}</span>
                <span className="d">{r.name}<small>{r.detail}</small></span>
              </li>
            ))}
            {!summary && <li className="running"><span className="n" /><span /><span className="d">Running. Each run makes about five live model calls.</span></li>}
          </ol>
          <div className="total">
            {summary ? (
              <div className={`stamp inline ${all ? "ok" : "bad"}`}>{all ? "Pass" : "Fail"} {summary.passed}/{summary.total}</div>
            ) : (
              <div className="progress">{rows.length} checks done</div>
            )}
            <div className="buttons">
              <button className="btn dark" type="button" disabled={!summary} onClick={() => setRound((n) => n + 1)}>Run again</button>
              <button className="btn dark" type="button" ref={closeRef} onClick={onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
