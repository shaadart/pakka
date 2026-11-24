import { useMemo } from "react";
import { code128 } from "../code128.js";

// A real Code 128 of the printed cache-key text, so a scanner reads exactly what is printed under it.
export default function Barcode({ text }) {
  const { width, rects } = useMemo(() => code128(text), [text]);
  return (
    <svg viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden="true">
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y="0" width={r.w} height="40" fill="currentColor" />
      ))}
    </svg>
  );
}
