import { defineConfig } from "@playwright/test";

// Two suites:
//   npm run test:ui    the UI against a mocked backend (deterministic, no model calls)
//   npm run test:live  the real stack from `make up` (http://localhost:3000); at most one live model call
const live = !!process.env.LIVE;

export default defineConfig({
  testDir: "tests",
  testMatch: live ? "live.spec.mjs" : "ui.spec.mjs",
  workers: live ? 1 : undefined,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: live ? process.env.LIVE_URL || "http://localhost:3000" : "http://localhost:3020",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    // 390 CSS px wide phones (iPhone 12-15) render at 3x; the barcode is read at that density.
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true } },
  ],
  webServer: live
    ? undefined
    : {
        command: "npx vite --port 3020 --strictPort",
        url: "http://localhost:3020",
        reuseExistingServer: false,
        env: { VITE_API_BASE_URL: "http://api.test" },
      },
});
