// Proves the receipt barcode is real Code 128: render it, then decode it with zbarimg.
// Run: node --test tests/code128.test.mjs  (the decode test needs rsvg-convert and zbarimg on PATH)
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { code128 } from "../src/code128.js";

const has = (bin) => { try { execFileSync("which", [bin], { stdio: "ignore" }); return true; } catch { return false; } };
const svg = ({ width, rects }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 40" width="${width * 3}" height="120" shape-rendering="crispEdges">` +
  `<rect width="${width}" height="40" fill="#fff"/>` +
  rects.map((r) => `<rect x="${r.x}" y="0" width="${r.w}" height="40" fill="#000"/>`).join("") + `</svg>`;

test("width is quiet + start + 11 per char + check + stop + quiet", () => {
  assert.equal(code128("91f5582007e5f3b0").width, 10 + 11 + 16 * 11 + 11 + 13 + 10);
});

test("rejects characters outside Code 128 B", () => {
  assert.throws(() => code128("é"));
});

test("zbarimg decodes what we encode", { skip: !(has("zbarimg") && has("rsvg-convert")) && "needs zbarimg and rsvg-convert" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "c128-"));
  for (const text of ["91f5582007e5f3b0", "0000000000000000", "ffffffffffffffff", "a1b2c3d4e5f60789"]) {
    writeFileSync(join(dir, "b.svg"), svg(code128(text)));
    execFileSync("rsvg-convert", ["-o", join(dir, "b.png"), join(dir, "b.svg")]);
    const out = execFileSync("zbarimg", ["-q", "--raw", join(dir, "b.png")]).toString().trim();
    assert.equal(out, text);
  }
});
