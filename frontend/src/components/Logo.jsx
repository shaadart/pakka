// Pakka Ghost Stub mark: crisp monochrome notched ticket over a quiet ghost twin
// (primary reply + cached/failover backup), with a clean perforation cut.
export default function Logo({ variant = "counter", className }) {
  const stamp = variant === "stamp";
  const fill = stamp ? "var(--counter)" : "var(--paper)";
  const cut = stamp ? "var(--paper)" : "var(--counter)";

  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path
        className="ticket-ghost"
        d="M 19 16 A 3 3 0 0 1 22 13 H 51 A 3 3 0 0 1 54 16 V 28.5 A 5 5 0 0 0 54 38.5 V 51 A 3 3 0 0 1 51 54 H 22 A 3 3 0 0 1 19 51 V 38.5 A 5 5 0 0 0 19 28.5 Z"
        fill={fill}
        opacity="0.24"
      />
      <path
        className="ticket-front"
        d="M 10 13 A 3 3 0 0 1 13 10 H 42 A 3 3 0 0 1 45 13 V 25.5 A 5 5 0 0 0 45 35.5 V 48 A 3 3 0 0 1 42 51 H 13 A 3 3 0 0 1 10 48 V 35.5 A 5 5 0 0 0 10 25.5 Z"
        fill={fill}
      />
      <line
        x1="17"
        y1="30.5"
        x2="38"
        y2="30.5"
        stroke={cut}
        strokeWidth="2.4"
        strokeDasharray="4 3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
