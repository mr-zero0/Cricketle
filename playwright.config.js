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
    // `reducedMotion` is not a test option (the runner ignores it silently); it
    // has to travel in contextOptions to reach browser.newContext.
    contextOptions: { reducedMotion: "reduce" },
    baseURL: "http://127.0.0.1:" + PORT,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:" + PORT + "/api/health",
    reuseExistingServer: false,
    timeout: 30 * 1000,
    // CRICKETLE_SKIP_DOTENV keeps a developer's .env (and its Supabase project)
    // out of the e2e server: it always runs on the throwaway SQLite file.
    // CRICKETLE_RATE_LIMIT=off: the suite creates more accounts per hour from
    // 127.0.0.1 than the sign-up throttle (5/hour) allows.
    env: { PORT: String(PORT), CRICKETLE_DB: dbPath, CRICKETLE_SECRET: "public", CRICKETLE_SKIP_DOTENV: "1", CRICKETLE_RATE_LIMIT: "off" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
