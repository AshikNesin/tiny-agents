import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false, // Run sequentially to avoid browser conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid parallel browser issues
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Use headed mode for local development (works better on macOS)
    headless: !!process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Start the dev server directly via tsx (bypassing the `pnpm dev` portless
    // wrapper, which conflicts with Playwright's port-availability check).
    // Migrations + seed run first so the demo user exists. The command inherits
    // DATABASE_URL from the environment, so e2e runs on the same
    // engine as the rest of the suite (SQLite by default).
    // TINY_AGENTS_FAUX=1 (ambient env prefix; NOT a schema var — varlock
    // would re-resolve and mask it) swaps the Cloudflare gateway for a
    // scripted echo model: no network, no keys — e2e exercises the durable
    // pipeline itself. The token speed keeps every reply busy for a real
    // window so steering/queueing tests can send mid-reply.
    command:
      "pnpm exec tsx scripts/seed.ts && " +
      "TINY_AGENTS_FAUX=1 TINY_AGENTS_FAUX_TOKENS_PER_SECOND=6 pnpm exec tsx watch --max-old-space-size=512 apps/web/src/server/entry.node.ts",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 240 * 1000,
  },
});
