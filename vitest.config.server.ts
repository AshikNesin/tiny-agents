import { defineConfig } from "vite-plus";
import path from "node:path";

const rootDir = path.resolve();

export default defineConfig({
  root: ".",
  test: {
    include: ["tests/server/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/server/setup.ts"],
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
    },
  },
});
