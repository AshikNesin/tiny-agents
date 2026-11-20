// Time budgets for the Tests workflow's jobs, enforced by the jobs themselves:
// a job that runs past its budget fails, even when everything in it passed,
// so CI cannot slow down unnoticed. Raising a budget is a change to this
// table, made in a PR that says why; a timeout-minutes someone bumps is not.
//
// Each job:
//   1. records its start before anything else:
//        echo "CI_STARTED_AT=$(date +%s)" >> "$GITHUB_ENV"
//   2. after checkout and setup:     node scripts/ci-budget.mjs setup
//   3. after its work:               node scripts/ci-budget.mjs run <job>
// Each check prints the phase's time against its budget, adds a line to the
// job summary, and fails the step when the phase ran over.

import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Seconds from a job's first step to the end of `.github/actions/setup`. */
export const SETUP_BUDGET = 30;

/** Seconds each job's work may take after setup, by job id. */
export const RUN_BUDGETS = {
  secrets: 10,
  lint: 5,
  typecheck: 5,
  gates: 30,
  migrations: 15,
  build: 30,
  server: 60,
  client: 60,
  "repo-typecheck": 60,
};

/**
 * Budgets for a job whose own cache missed (CI_CACHE_COLD=1): the first run
 * before main has the cache. Only a job that restores a cache of its own work
 * has one; a warm run is still held to RUN_BUDGETS.
 */
export const COLD_RUN_BUDGETS = {
  typecheck: 20,
};

/** The budget verdict for a phase that took `seconds`, as a line to print. */
export function verdict(phase, seconds, budget) {
  const over = seconds > budget;
  return {
    over,
    line: `${over ? "✗" : "✓"} ${phase}: ${seconds}s of a ${budget}s budget${over ? `, ${seconds - budget}s over` : ""}`,
  };
}

function main() {
  const [phase, job] = process.argv.slice(2);
  const now = Math.floor(Date.now() / 1000);
  const env = process.env;
  let started;
  let budget;
  let label;
  if (phase === "setup") {
    started = Number(env.CI_STARTED_AT);
    budget = SETUP_BUDGET;
    label = "setup";
  } else if (phase === "run" && job in RUN_BUDGETS) {
    started = Number(env.CI_SETUP_DONE_AT);
    const cold = env.CI_CACHE_COLD === "1" && job in COLD_RUN_BUDGETS;
    budget = cold ? COLD_RUN_BUDGETS[job] : RUN_BUDGETS[job];
    label = cold ? `${job} (cold cache)` : job;
  } else {
    console.error(
      `Usage: ci-budget.mjs setup | run <job>. Jobs: ${Object.keys(RUN_BUDGETS).join(", ")}.`,
    );
    process.exit(2);
  }
  if (!Number.isFinite(started)) {
    console.error(
      `No start time for "${label}": the job must record CI_STARTED_AT first and run "ci-budget.mjs setup" after setup.`,
    );
    process.exit(2);
  }
  const { over, line } = verdict(label, now - started, budget);
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (phase === "setup" && env.GITHUB_ENV)
    appendFileSync(env.GITHUB_ENV, `CI_SETUP_DONE_AT=${now}\n`);
  if (over) {
    console.error(
      `::error::${label} took ${now - started}s, over its ${budget}s budget (scripts/ci-budget.mjs). Make it faster; raise the budget only with a reason in the PR.`,
    );
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
