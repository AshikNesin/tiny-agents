import { defineConfig } from "vite-plus";
import { readFileSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";

const rootDir = path.resolve();
// Most server test files wait on timers and child processes, not the CPU.
const WORKERS_PER_CORE = 2;
/**
 * Suites that type-check whole copies of the repo in child processes (tsx,
 * tsc): CPU-bound for a minute or more each. Run alongside the rest on CI's
 * runner they starved it, and unrelated tests hit their 5-second timeout
 * (even a synchronous snapshot test). They run as their own group, after
 * every other server test.
 */
const REPO_TYPECHECK_SUITES = [
  "tests/server/checks/kit-exports.test.ts",
  "tests/server/checks/typecheck-coverage.test.ts",
];

/**
 * Files that replace a module (`vi.mock`, `vi.doMock`) run isolated: the
 * `server` project shares one module graph per worker, and a mock cannot
 * replace a module an earlier file already loaded. Found by reading the
 * files, so a new one lands in the right project without a list to update.
 */
const MODULE_MOCK = /\bvi\.(mock|doMock|unmock|doUnmock|resetModules)\(/;
const MODULE_MOCK_SUITES = readdirSync("tests/server", { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => path.posix.join("tests/server", file.split(path.sep).join("/")))
  .filter((file) => !REPO_TYPECHECK_SUITES.includes(file))
  .filter((file) => MODULE_MOCK.test(readFileSync(file, "utf8")));

// Never reach real services from tests, whatever the shell exports: with real
// Pushover keys in the environment, the notification route tests sent actual
// test pushes (their fetch spy watches calls, it does not stop them). Remove the
// keys and model settings outright, matching CI, which sets none of them.
// Test workers inherit this process's environment.
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
    // Files and the tests in them run in a new random order every run, so a
    // test that leans on another's leftovers fails. The seed is printed at the
    // top of the run; rerun one order with --sequence.seed=<seed>.
    sequence: { shuffle: true },
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
          // Load the app once per worker, not once per file: the setup gives
          // each file a fresh database and App root, and fails a file that
          // leaves anything else behind (tests/server/fixtures/file-isolation.ts).
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
      // Files that each leave one thing behind, so tests/server/checks/
      // file-isolation.test.ts can watch the setup fail them. Only that test
      // turns them on.
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
