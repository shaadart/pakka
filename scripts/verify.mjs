#!/usr/bin/env node
// Run the assignment contract against a backend: node scripts/verify.mjs [URL] [--no-memory]
// The checks live in frontend/src/inspection/checks.js, the same file the page's "Run inspection" button uses.
import { runInspection } from "../frontend/src/inspection/checks.js";

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--")) || "http://localhost:8000";
const memory = !args.includes("--no-memory");

console.log(`Pakka contract check against ${base}\n`);
const { passed, total } = await runInspection({
  base,
  memory,
  onResult: (r) => console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}\n        ${r.detail}`),
});
console.log(`\n${passed} of ${total} passed${memory ? "" : " (memory check skipped)"}`);
process.exit(passed === total ? 0 : 1);
