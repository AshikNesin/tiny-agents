import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vite-plus/test";
import { GATE_JOBS, gates, selectGates } from "../../../scripts/gates.mjs";
import { RUN_BUDGETS, verdict } from "../../../scripts/ci-budget.mjs";
import { workflowProblems, type Workflow } from "../../../scripts/lib/workflow-coverage";

const FILE = ".github/workflows/test.yml";
const real = () => load(readFileSync(FILE, "utf8")) as Workflow;
const problems = (workflow: Workflow) =>
  workflowProblems({
    file: FILE,
    workflow,
    gateJobs: GATE_JOBS,
    runBudgets: RUN_BUDGETS,
  });

describe("the Tests workflow", () => {
  const steps = (workflow: Workflow) => workflow.jobs.ci!.steps!;

  it("runs every gate job once, times every phase and drops no shard", () => {
    expect(problems(real())).toEqual([]);
  });

  it("fails when a gate job's step is gone", () => {
    const workflow = real();
    workflow.jobs.ci!.steps = steps(workflow).filter(
      (step) => step.run !== "pnpm verify:static --job lint",
    );
    expect(problems(workflow)).toContain(
      `${FILE} runs \`pnpm verify:static --job lint\` in 0 steps. It needs exactly one, so CI runs every gate in scripts/gates.mjs once.`,
    );
  });

  it("fails when a part is dropped from the matrix", () => {
    const workflow = real();
    workflow.jobs.ci!.strategy!.matrix!.part = [1];
    expect(problems(workflow)).toContain(
      `${FILE} job "ci" splits into 2 shards but its matrix lists part [1]. List [1,2], or a shard's files never run.`,
    );
  });

  it("fails when a phase's budget check is gone, or runs under another condition", () => {
    const workflow = real();
    workflow.jobs.ci!.steps = steps(workflow).filter(
      (step) => step.run !== "node scripts/ci-budget.mjs run build",
    );
    const lint = steps(workflow).find(
      (step) => step.run === "node scripts/ci-budget.mjs run lint",
    )!;
    delete lint.if;
    const found = problems(workflow);
    expect(found).toContain(
      `${FILE} checks the "build" budget (scripts/ci-budget.mjs) in 0 steps. It needs exactly one, after the phase's work.`,
    );
    expect(found).toContain(
      `${FILE} job "ci" checks the "lint" budget under a different condition than the step before it, so the check can run without its phase or skip it.`,
    );
  });

  it("fails when the merge queue no longer runs it", () => {
    const workflow = real();
    delete workflow.on!.merge_group;
    expect(problems(workflow)).toContain(
      `${FILE} does not run on merge_group. The merge queue's full run is what keeps PR test selection honest.`,
    );
  });

  it("fails a post-build check moved before the build", () => {
    const workflow = real();
    const closure = steps(workflow).findIndex((step) => step.run === "pnpm check:closure");
    const [step] = steps(workflow).splice(closure, 1);
    steps(workflow).splice(3, 0, step!);
    expect(
      problems(workflow).some((p) =>
        p.includes('step "Runtime dependency closure" runs `pnpm check:closure` outside'),
      ),
    ).toBe(true);
  });

  it("fails a static check run outside the gates", () => {
    const workflow = real();
    steps(workflow).splice(3, 0, { name: "Extra", run: "pnpm exec tsc --noEmit" });
    expect(
      problems(workflow).some((p) =>
        p.includes('step "Extra" runs `tsc` outside the static gates'),
      ),
    ).toBe(true);
  });
});

describe("gate selection", () => {
  it("runs every gate without --job, and one job's gates with it", () => {
    expect(selectGates([]).gates).toEqual(gates);
    expect(selectGates(["--job", "migrations"]).gates?.map((gate) => gate.name)).toEqual([
      "Migrations are up to date with the schema",
      "Applied migrations unchanged",
    ]);
    expect(selectGates(["--job", "nope"]).error).toBe(
      'Unknown gate job "nope". Jobs: typecheck, lint, gates, migrations.',
    );
  });
});

describe("budgets", () => {
  it("passes a phase within its budget and fails one past it, saying by how much", () => {
    expect(verdict("lint", 5, 5)).toEqual({ over: false, line: "✓ lint: 5s of a 5s budget" });
    expect(verdict("server", 64, 60)).toEqual({
      over: true,
      line: "✗ server: 64s of a 60s budget, 4s over",
    });
  });
});
