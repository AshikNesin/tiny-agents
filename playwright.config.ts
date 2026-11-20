import { existsSync } from "node:fs";
import { chromium, defineConfig, devices } from "@playwright/test";

function chromiumPath(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit) return explicit;
  const preinstalled = "/opt/pw-browsers/chromium";
  if (!existsSync(chromium.executablePath()) && existsSync(preinstalled)) return preinstalled;
  return undefined;
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    headless: !!process.env.CI,
    launchOptions: { executablePath: chromiumPath() },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "rm -f data/e2e.db data/e2e.db-shm data/e2e.db-wal && " +
      "DATABASE_URL=file:./data/e2e.db pnpm exec tsx scripts/seed.ts && " +
      "DATABASE_URL=file:./data/e2e.db TINY_AGENTS_FAUX=1 TINY_AGENTS_FAUX_TOKENS_PER_SECOND=6 AUTH_RATE_LIMIT_MAX=1000 " +
      "pnpm exec tsx watch --max-old-space-size=1024 apps/web/src/server/entry.node.ts",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 240 * 1000,
  },
});
