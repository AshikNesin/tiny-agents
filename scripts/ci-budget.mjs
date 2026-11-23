import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const SETUP_BUDGET = 30;

export const COLD_SETUP_BUDGET = 120;

export const RUN_BUDGETS = {
  secrets: 20,
  lint: 10,
  typecheck: 5,
  gates: 30,
  migrations: 15,
  build: 30,
  server: 60,
  client: 60,
  "repo-typecheck": 60,
};

export const COLD_RUN_BUDGETS = {
  lint: 20,
  typecheck: 20,
};

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
    const cold = env.CI_SETUP_COLD === "1";
    budget = cold ? COLD_SETUP_BUDGET : SETUP_BUDGET;
    label = cold ? "setup (cold cache)" : "setup";
  } else if (phase === "run" && Object.hasOwn(RUN_BUDGETS, job)) {
    started = Number(env.CI_PHASE_AT);
    const cold = env.CI_CACHE_COLD === "1" && Object.hasOwn(COLD_RUN_BUDGETS, job);
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
      `No start time for "${label}": the job must record CI_STARTED_AT first and run "ci-budget.mjs setup" after its setup.`,
    );
    process.exit(2);
  }
  const { over, line } = verdict(label, now - started, budget);
  console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, `CI_PHASE_AT=${now}\n`);
  if (over) {
    console.error(
      `::error::${label} took ${now - started}s, over its ${budget}s budget (scripts/ci-budget.mjs). Make it faster; raise the budget only with a reason in the PR.`,
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
