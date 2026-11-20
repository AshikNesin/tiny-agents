import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vite-plus/test";
import { GATE_JOBS, selectGates } from "../../../scripts/gates.mjs";
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
    postBuildChecks: ["check:closure"],
  });

describe("the Tests workflow", () => {
  it("runs every gate job once, times every job and drops no shard", () => {
    expect(problems(real())).toEqual([]);
  });

  it("fails when a gate job's step is gone", () => {
    const workflow = real();
    workflow.jobs.lint!.steps = workflow.jobs.lint!.steps!.filter(
      (step) => step.run !== "pnpm verify:static --job lint",
    );
    expect(problems(workflow)).toContain(
      `${FILE} runs \`pnpm verify:static --job lint\` in 0 steps. It needs exactly one, so CI runs every gate in scripts/gates.mjs once.`,
    );
  });

  it("fails when a shard is dropped from a matrix", () => {
    const workflow = real();
    workflow.jobs.client!.strategy!.matrix!.shard = [1, 2];
    expect(problems(workflow)).toContain(
      `${FILE} job "client" splits into 3 shards but its matrix lists shard [1,2]. List [1,2,3], or a shard's files never run.`,
    );
  });

  it("fails when a job stops checking its budget, or CI stops waiting for it", () => {
    const workflow = real();
    workflow.jobs.build!.steps = workflow.jobs.build!.steps!.slice(0, -1);
    workflow.jobs.ci!.needs = ["secrets"];
    const found = problems(workflow);
    expect(found).toContain(
      `${FILE} job "build" does not check its run budget last: add a step running \`node scripts/ci-budget.mjs run build\`.`,
    );
    expect(found).toContain(`${FILE} job "ci" does not need "server", so CI can pass without it.`);
  });

  it("fails a static check run outside the gates", () => {
    const workflow = real();
    workflow.jobs.build!.steps!.splice(1, 0, { name: "Extra", run: "pnpm exec tsc --noEmit" });
    expect(
      problems(workflow).some((p) =>
        p.includes('step "Extra" runs `tsc` outside the static gates'),
      ),
    ).toBe(true);
  });
});

describe("gate selection", () => {
  it("runs every gate without --job, and one job's gates with it", () => {
    expect(selectGates([]).gates).toHaveLength(18);
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
