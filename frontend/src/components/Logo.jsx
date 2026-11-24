import { useId } from "react";

// Pakka Single-Cut mark: one monochrome notched ticket, cleanly sliced on a rising tear line.
export default function Logo({ variant = "counter", className }) {
  const id = useId();
  const fill = variant === "stamp" ? "var(--counter)" : "var(--paper)";
  const ticket =
    "M 15 10 A 3.5 3.5 0 0 1 18.5 6.5 H 45.5 A 3.5 3.5 0 0 1 49 10 V 25 A 6.5 6.5 0 0 0 49 38 V 54 A 3.5 3.5 0 0 1 45.5 57.5 H 18.5 A 3.5 3.5 0 0 1 15 54 V 38 A 6.5 6.5 0 0 0 15 25 Z";

  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <defs>
        <clipPath id={`${id}-t`}><polygon points="0,0 64,0 64,25.2 0,34.4" /></clipPath>
        <clipPath id={`${id}-b`}><polygon points="0,38 64,28.8 64,64 0,64" /></clipPath>
      </defs>
      <g className="ticket-top">
        <path d={ticket} fill={fill} clipPath={`url(#${id}-t)`} />
      </g>
      <g className="ticket-bot">
        <path d={ticket} fill={fill} clipPath={`url(#${id}-b)`} />
      </g>
    </svg>
  );
}
