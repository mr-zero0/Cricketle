// Playwright end-to-end configuration.
// Boots the real server on a spare port with a throwaway database and the public
// answer seed, so the spec can compute today's answers with the shared core.
"use strict";
// The cached Chromium build is used as-is; skip Playwright's Windows dependency probe.
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS || "1";
const path = require("node:path");
const os = require("node:os");
const { defineConfig, devices } = require("@playwright/test");

const PORT = Number(process.env.E2E_PORT) || 3177;
const dbPath = path.join(os.tmpdir(), "cricketle-e2e-" + process.pid + ".db");

module.exports = defineConfig({
  testDir: "./test/e2e",
  timeout: 90 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    // Full Chromium in new-headless mode (reuses the cached build; no headless-shell download).
    channel: "chromium",
    // Static stadium scene and no CSS motion: deterministic and far cheaper to drive.
    reducedMotion: "reduce",
    baseURL: "http://127.0.0.1:" + PORT,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:" + PORT + "/api/health",
    reuseExistingServer: false,
    timeout: 30 * 1000,
    env: { PORT: String(PORT), CRICKETLE_DB: dbPath, CRICKETLE_SECRET: "public" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
