import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running stack (web + API + websocket) with the
 * demo data from `bun run seed` in apps/backend. See README → Tests.
 *
 *   E2E_BASE_URL=http://localhost:3000 bun run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
