export interface WorkflowStep {
  name?: string;
  if?: string;
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
  postBuildChecks: readonly string[];
}

const STATIC_CHECK =
  /\btsc\b|scripts\/check-[\w-]+|db:generate|\bpnpm (?:run )?((?:check|typecheck)[\w:-]*)/g;
const GATE_STEP = /^pnpm verify:static(?: --job (\S+))?$/;
const START_STEP = 'echo "CI_STARTED_AT=$(date +%s)" >> "$GITHUB_ENV"';
const SHARD = /--shard=\$\{\{ matrix\.(\w+) \}\}\/(\d+)/;

export function workflowProblems({
  file,
  workflow,
  gateJobs,
  runBudgets,
  postBuildChecks,
}: CoverageInputs): string[] {
  const problems: string[] = [];
  const jobs = Object.entries(workflow.jobs);

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

  const checked: string[] = [];
  for (const [id, job] of jobs) {
    const steps = job.steps ?? [];
    const runs = steps.map((step) => step.run?.trim() ?? "");
    if (runs[0] !== START_STEP) {
      problems.push(
        `${file} job "${id}" must record its start in its first step: \`${START_STEP}\`.`,
      );
    }
    if (!runs.includes("node scripts/ci-budget.mjs setup")) {
      problems.push(
        `${file} job "${id}" does not check its setup budget: add a step running \`node scripts/ci-budget.mjs setup\`.`,
      );
    }
    steps.forEach((step, i) => {
      const phase = /^node scripts\/ci-budget\.mjs run (\S+)$/.exec(runs[i]!)?.[1];
      if (!phase) return;
      checked.push(phase);
      const before = steps[i - 1];
      if (!before || (before.if ?? "") !== (step.if ?? "")) {
        problems.push(
          `${file} job "${id}" checks the "${phase}" budget under a different condition than the step before it, so the check can run without its phase or skip it.`,
        );
      }
    });
  }
  for (const phase of Object.keys(runBudgets)) {
    const count = checked.filter((c) => c === phase).length;
    if (count !== 1) {
      problems.push(
        `${file} checks the "${phase}" budget (scripts/ci-budget.mjs) in ${count} steps. It needs exactly one, after the phase's work.`,
      );
    }
  }
  for (const phase of new Set(checked)) {
    if (!(phase in runBudgets)) {
      problems.push(
        `${file} checks a "${phase}" budget that RUN_BUDGETS (scripts/ci-budget.mjs) does not have.`,
      );
    }
  }

  for (const [id, job] of jobs) {
    for (const step of job.steps ?? []) {
      const shard = step.run ? SHARD.exec(step.run) : null;
      if (!shard) continue;
      const [, key, total] = shard;
      const count = Number(total);
      const listed = job.strategy?.matrix?.[key!];
      const expected = Array.from({ length: count }, (_, i) => i + 1);
      if (JSON.stringify(listed) !== JSON.stringify(expected)) {
        problems.push(
          `${file} job "${id}" splits into ${count} shards but its matrix lists ${key} ${JSON.stringify(listed ?? null)}. List ${JSON.stringify(expected)}, or a shard's files never run.`,
        );
      }
    }
  }

  if (!workflow.on || !("merge_group" in workflow.on)) {
    problems.push(
      `${file} does not run on merge_group. The merge queue's full run is what keeps PR test selection honest.`,
    );
  }

  return problems;
}
