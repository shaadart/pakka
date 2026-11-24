import { useMemo } from "react";

// The bars are drawn from the cache key, so equal keys print equal barcodes.
function build(hex) {
  let x = 0;
  const rects = [];
  const bar = (w) => { rects.push({ x, w }); x += w; };
  bar(1); x += 1; bar(1); x += 2;
  for (const ch of hex) {
    const n = parseInt(ch, 16) || 0;
    bar(1 + (n & 3)); x += 1 + ((n >> 2) & 1);
    bar(1 + ((n >> 3) & 1)); x += 1 + ((n >> 1) & 1);
  }
  x += 1; bar(1); x += 1; bar(1);
  return { width: x, rects };
}

export default function Barcode({ hex }) {
  const { width, rects } = useMemo(() => build(hex), [hex]);
  return (
    <svg viewBox={`0 0 ${width} 38`} preserveAspectRatio="none" role="img" aria-label={`Barcode of cache key ${hex.slice(0, 12)}`}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y="0" width={r.w} height="38" fill="currentColor" />
      ))}
    </svg>
  );
}
