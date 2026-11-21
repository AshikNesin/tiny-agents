import { defineConfig } from "vite-plus";
import { readFileSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { DurationSequencer } from "./tests/sequencer";

const rootDir = path.resolve();
const WORKERS_PER_CORE = 2;
const REPO_TYPECHECK_SUITES = [
  "tests/server/checks/kit-exports.test.ts",
  "tests/server/checks/typecheck-coverage.test.ts",
];

const MODULE_MOCK = /\bvi\.(mock|doMock|unmock|doUnmock|resetModules)\(/;
const MODULE_MOCK_SUITES = readdirSync("tests/server", { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => path.posix.join("tests/server", file.split(path.sep).join("/")))
  .filter((file) => !REPO_TYPECHECK_SUITES.includes(file))
  .filter((file) => MODULE_MOCK.test(readFileSync(file, "utf8")));

for (const key of [
  "PUSHOVER_API_TOKEN",
  "PUSHOVER_USER_KEY",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SENTRY_DSN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "COPILOT_GITHUB_TOKEN",
  "GEMINI_API_KEY",
]) {
  delete process.env[key];
}

export default defineConfig({
  root: ".",
  test: {
    sequence: { shuffle: true, sequencer: DurationSequencer },
    environment: "node",
    setupFiles: ["./tests/server/setup.ts"],
    maxWorkers: availableParallelism() * WORKERS_PER_CORE,
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          include: ["tests/server/**/*.test.ts"],
          exclude: [...REPO_TYPECHECK_SUITES, ...MODULE_MOCK_SUITES],
          isolate: false,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "server:isolated",
          include: MODULE_MOCK_SUITES,
          sequence: { groupOrder: 0 },
        },
      },
      ...(process.env.ISOLATION_PROBES === "1"
        ? [
            {
              extends: true,
              test: {
                name: "server:isolation-probes",
                include: ["tests/server/checks/isolation-probes/*.probe.ts"],
                isolate: false,
              },
            },
          ]
        : []),
      {
        extends: true,
        test: {
          name: "server:repo-typecheck",
          include: REPO_TYPECHECK_SUITES,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@groot/core": path.resolve(rootDir, "packages/core/src"),
      "@groot/jobs/server": path.resolve(rootDir, "packages/jobs/src/server"),
      "@tiny-agents/code/contracts": path.resolve(rootDir, "packages/code/src/contracts/index.ts"),
      "@tiny-agents/code/server": path.resolve(rootDir, "packages/code/src/server/index.ts"),
      "@tiny-agents/code/testing": path.resolve(rootDir, "packages/code/src/testing.ts"),
    },
  },
});
