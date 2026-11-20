/**
 * What `pnpm check:coverage` holds the Tests workflow to, so it can neither
 * skip a check nor slow down unnoticed:
 *
 *  - each gate job of scripts/gates.mjs runs in exactly one step,
 *    `pnpm verify:static --job <job>`, and no other step runs a static check
 *    (a check that needs `pnpm build` first may follow the build step);
 *  - every job but the final `ci` records its start, checks its setup budget
 *    and ends with `node scripts/ci-budget.mjs run <its id>`, and the job ids
 *    are exactly the budgets in scripts/ci-budget.mjs;
 *  - a step that runs `--shard=${{ matrix.shard }}/N` sits in a job whose
 *    matrix lists shards 1 to N, so no shard (and none of its files) is
 *    dropped;
 *  - the `ci` job needs every other job;
 *  - the workflow runs on `merge_group`, where the test jobs run everything
 *    (scripts/test-selection.mjs selects only on pull requests), so the full
 *    suite runs before anything reaches main.
 */

export interface WorkflowStep {
  name?: string;
  run?: string;
}

export interface WorkflowJob {
  needs?: string | string[];
  strategy?: { matrix?: Record<string, unknown> };
  steps?: WorkflowStep[];
}

export interface Workflow {
  on?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

export interface CoverageInputs {
  file: string;
  workflow: Workflow;
  gateJobs: readonly string[];
  runBudgets: Record<string, number>;
  /** Package scripts a step may run after `pnpm build`. */
  postBuildChecks: readonly string[];
}

const STATIC_CHECK =
  /\btsc\b|scripts\/check-[\w-]+|db:generate|\bpnpm ((?:check|typecheck)[\w:-]*)/g;
const GATE_STEP = /^pnpm verify:static(?: --job (\S+))?$/;
const START_STEP = 'echo "CI_STARTED_AT=$(date +%s)" >> "$GITHUB_ENV"';
const SHARD = /--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/;

export function workflowProblems({
  file,
  workflow,
  gateJobs,
  runBudgets,
  postBuildChecks,
}: CoverageInputs): string[] {
  const problems: string[] = [];
  const jobs = Object.entries(workflow.jobs);

  // Gates: each gate job in exactly one step, nothing static outside them.
  const ranJobs: string[] = [];
  for (const [id, job] of jobs) {
    const steps = (job.steps ?? []).filter(
      (step): step is WorkflowStep & { run: string } => typeof step.run === "string",
    );
    const buildAt = steps.findIndex((step) => /\bpnpm build\b/.test(step.run));
    steps.forEach((step, i) => {
      const gate = GATE_STEP.exec(step.run.trim());
      if (gate) {
        if (!gate[1]) {
          problems.push(
            `${file} job "${id}" runs \`pnpm verify:static\` without --job. Run each gate job in its own workflow job.`,
          );
        } else ranJobs.push(gate[1]);
        return;
      }
      for (const match of step.run.matchAll(STATIC_CHECK)) {
        if (match[1] && postBuildChecks.includes(match[1])) continue;
        const fix =
          buildAt !== -1 && i > buildAt && match[1]
            ? `If it needs \`pnpm build\` first, add "${match[1]}" to POST_BUILD_CHECKS in scripts/check-checks-coverage.ts. Otherwise move it to scripts/gates.mjs and delete the step.`
            : "Add it to scripts/gates.mjs and delete the step, so `pnpm verify:static` runs it locally too.";
        problems.push(
          `${file} job "${id}" step "${step.name ?? step.run}" runs \`${match[0]}\` outside the static gates. ${fix}`,
        );
      }
    });
  }
  for (const gateJob of gateJobs) {
    const count = ranJobs.filter((ran) => ran === gateJob).length;
    if (count !== 1) {
      problems.push(
        `${file} runs \`pnpm verify:static --job ${gateJob}\` in ${count} steps. It needs exactly one, so CI runs every gate in scripts/gates.mjs once.`,
      );
    }
  }
  for (const ran of new Set(ranJobs)) {
    if (!gateJobs.includes(ran)) {
      problems.push(
        `${file} runs \`pnpm verify:static --job ${ran}\`, a job scripts/gates.mjs does not define.`,
      );
    }
  }

  // Budgets: every job but `ci` times itself, under its own id.
  const timed = jobs.filter(([id]) => id !== "ci");
  for (const [id, job] of timed) {
    const runs = (job.steps ?? []).map((step) => step.run?.trim() ?? "");
    const missing = [
      [START_STEP, "record its start first"],
      ["node scripts/ci-budget.mjs setup", "check its setup budget"],
      [`node scripts/ci-budget.mjs run ${id}`, "check its run budget last"],
    ].filter(([command]) => !runs.includes(command!));
    for (const [command, what] of missing) {
      problems.push(`${file} job "${id}" does not ${what}: add a step running \`${command}\`.`);
    }
    if (runs[0] !== START_STEP && !missing.some(([command]) => command === START_STEP)) {
      problems.push(`${file} job "${id}" must record CI_STARTED_AT in its first step.`);
    }
    if (
      runs.at(-1) !== `node scripts/ci-budget.mjs run ${id}` &&
      runs.includes(`node scripts/ci-budget.mjs run ${id}`)
    ) {
      problems.push(`${file} job "${id}" must check its run budget in its last step.`);
    }
  }
  const timedIds = timed.map(([id]) => id);
  for (const budget of Object.keys(runBudgets)) {
    if (!timedIds.includes(budget)) {
      problems.push(`scripts/ci-budget.mjs budgets a "${budget}" job that ${file} does not have.`);
    }
  }
  for (const id of timedIds) {
    if (!(id in runBudgets)) {
      problems.push(`${file} job "${id}" has no budget in RUN_BUDGETS (scripts/ci-budget.mjs).`);
    }
  }

  // Shards: the matrix lists every shard the step splits into.
  for (const [id, job] of jobs) {
    for (const step of job.steps ?? []) {
      const shard = step.run ? SHARD.exec(step.run) : null;
      if (!shard) continue;
      const count = Number(shard[1]);
      const listed = job.strategy?.matrix?.shard;
      const expected = Array.from({ length: count }, (_, i) => i + 1);
      if (JSON.stringify(listed) !== JSON.stringify(expected)) {
        problems.push(
          `${file} job "${id}" splits into ${count} shards but its matrix lists shard ${JSON.stringify(listed ?? null)}. List ${JSON.stringify(expected)}, or a shard's files never run.`,
        );
      }
    }
  }

  // The merge queue runs the full suite.
  if (!workflow.on || !("merge_group" in workflow.on)) {
    problems.push(
      `${file} does not run on merge_group. The merge queue's full run is what keeps PR test selection honest.`,
    );
  }

  // The required check waits for everything.
  const ci = workflow.jobs.ci;
  if (!ci) {
    problems.push(`${file} has no "ci" job, the one required check.`);
  } else {
    const needs = [ci.needs ?? []].flat();
    for (const id of timedIds) {
      if (!needs.includes(id))
        problems.push(`${file} job "ci" does not need "${id}", so CI can pass without it.`);
    }
  }
  return problems;
}
