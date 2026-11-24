import { useEffect, useRef, useState } from "react";

export const SAMPLES = ["Kal 11 baje slot milega?", "Mera naam Asha hai", "Mera naam kya hai?"];
const LIMIT = 4000;

// Owns the draft text, so typing re-renders only this box and not the whole chat.
export default function Composer({ onSend, pending }) {
  const [text, setText] = useState("");
  const inputRef = useRef(null);
  const count = text.trim().length; // the backend trims too, so both count the same thing

  useEffect(() => {
    const el = inputRef.current;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  async function submit(raw, fromBox) {
    if (pending) return;
    if (fromBox) setText("");
    const giveBack = await onSend(raw);
    if (giveBack) setText(giveBack); // too long: hand the text back so it can be trimmed
    inputRef.current?.focus();
  }

  return (
    <div className="composer-wrap">
      <div className="tries" role="group" aria-label="Sample messages">
        {SAMPLES.map((q) => (
          <button key={q} className="chip" type="button" onClick={() => submit(q, false)} disabled={pending}>{q}</button>
        ))}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(text, true); }}>
        <textarea
          id="message"
          ref={inputRef}
          data-testid="chat-input"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(text, true);
            }
          }}
          placeholder="Type a message"
          aria-label="Message"
          aria-describedby={count > LIMIT - 500 ? "count" : undefined}
        />
        <button className="btn primary send" type="submit" data-testid="send-button" disabled={pending}>Send</button>
      </form>
      {count > LIMIT - 500 && (
        <div id="count" className={`count${count > LIMIT ? " over" : ""}`}>{count} / {LIMIT}</div>
      )}
    </div>
  );
}
