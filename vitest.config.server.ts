import { defineConfig } from "vite-plus";
import path from "node:path";

const rootDir = path.resolve();

export default defineConfig({
  root: ".",
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    include: ["tests/server/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/server/setup.ts"],
    // Never reach real services from tests, whatever the shell exports: with
    // real Pushover keys in the environment, the notification route tests sent
    // actual test pushes (their fetch spy watches calls, it does not stop them).
    // Core treats "" as unset.
    env: {
      PUSHOVER_API_TOKEN: "",
      PUSHOVER_USER_KEY: "",
      CLOUDFLARE_API_KEY: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      CLOUDFLARE_GATEWAY_ID: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      SENTRY_DSN: "",
    },
    // Every file shares one test database and most reset whole tables
    // (bots, routines, ledger rows) between tests, so files running side by
    // side delete each other's rows. One file at a time keeps runs
    // deterministic on both engines.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@groot/ai": path.resolve(rootDir, "packages/ai/src"),
      "@groot/core": path.resolve(rootDir, "packages/core/src"),
      "@groot/jobs/server": path.resolve(rootDir, "packages/jobs/src/server"),
      "@tiny-agents/code/contracts": path.resolve(rootDir, "packages/code/src/contracts/index.ts"),
      "@tiny-agents/code/server": path.resolve(rootDir, "packages/code/src/server/index.ts"),
      "@tiny-agents/code/testing": path.resolve(rootDir, "packages/code/src/testing.ts"),
    },
  },
});
