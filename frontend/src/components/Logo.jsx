// Pakka mark: a printed receipt with a torn edge, over a ghost twin (the backup key, or the cached copy).
export default function Logo({ className }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path className="ticket-ghost" d="M 19 13 H 51 V 53 L 47 50 L 43 53 L 39 50 L 35 53 L 31 50 L 27 53 L 23 50 L 19 53 Z" fill="var(--paper)" opacity="0.24" />
      <path d="M 10 10 H 42 V 50 L 38 47 L 34 50 L 30 47 L 26 50 L 22 47 L 18 50 L 14 47 L 10 50 Z" fill="var(--paper)" />
      <line x1="16" y1="18" x2="36" y2="18" stroke="var(--counter)" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="16" y1="25" x2="29" y2="25" stroke="var(--counter)" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="16" y1="35" x2="36" y2="35" stroke="var(--counter)" strokeWidth="2.4" strokeDasharray="4 3.5" strokeLinecap="round" />
    </svg>
  );
}
