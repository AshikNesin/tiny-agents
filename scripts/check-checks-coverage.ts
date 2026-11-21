#!/usr/bin/env tsx
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import micromatch from "micromatch";
import { loadConfig } from "../.groot/lib/config";
import { ownedSourceRootsForTests, TEST_AREA_OWNERSHIP } from "../.groot/lib/patterns";
import { GATE_JOBS, gates } from "./gates.mjs";
import { RUN_BUDGETS } from "./ci-budget.mjs";
import { POST_BUILD_CHECKS, workflowProblems, type Workflow } from "./lib/workflow-coverage";

const ROOT = new URL("..", import.meta.url).pathname;

const { additional_exclusions } = await loadConfig(ROOT);
const excludedFromSync = (dirOrRoot: string) =>
  micromatch.isMatch(dirOrRoot.replace(/\/\*\*$/, ""), additional_exclusions);

function expandRoot(root: string): string[] {
  if (!root.includes("*")) return existsSync(join(ROOT, root)) ? [root] : [];
  const parts = root.split("/");
  const starAt = parts.indexOf("*");
  const base = join(ROOT, ...parts.slice(0, starAt));
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((entry) => statSync(join(base, entry)).isDirectory())
    .map((entry) => [...parts.slice(0, starAt), entry, ...parts.slice(starAt + 1)].join("/"))
    .filter((dir) => existsSync(join(ROOT, dir)));
}

interface Failure {
  kind: "root-missing" | "area-missing" | "area-empty" | "workflow" | "script-not-a-gate";
  detail: string;
}

const failures: Failure[] = [];

const ownedRoots = ownedSourceRootsForTests().filter((root) => !excludedFromSync(root));
for (const root of ownedRoots) {
  const dir = root.replace(/\/\*\*$/, "");
  if (expandRoot(dir).length === 0) {
    failures.push({
      kind: "root-missing",
      detail: `Owned source root "${root}" (from .groot/lib/patterns.ts TEST_AREA_OWNERSHIP) matches no directory on disk. Update the ownership map.`,
    });
  }
}

function countTestFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countTestFiles(join(dir, entry.name));
    } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
      count += 1;
    }
  }
  return count;
}

const areas = Object.keys(TEST_AREA_OWNERSHIP).filter((area) => !excludedFromSync(area));
for (const area of areas) {
  if (!existsSync(join(ROOT, area))) {
    failures.push({
      kind: "area-missing",
      detail: `Declared test area "${area}" does not exist on disk. Rename or remove it in .groot/lib/patterns.ts TEST_AREA_OWNERSHIP — until then every suite under it classifies as drift in sync.`,
    });
    continue;
  }
  const tests = countTestFiles(area);
  if (tests === 0) {
    failures.push({
      kind: "area-empty",
      detail: `Declared test area "${area}" holds no test files. An area with no tests cannot own synced source; remove it from TEST_AREA_OWNERSHIP or add its suite.`,
    });
  }
}

const WORKFLOW = ".github/workflows/test.yml";
for (const detail of workflowProblems({
  file: WORKFLOW,
  workflow: loadYaml(readFileSync(join(ROOT, WORKFLOW), "utf8")) as Workflow,
  gateJobs: GATE_JOBS,
  runBudgets: RUN_BUDGETS,
})) {
  failures.push({ kind: "workflow", detail });
}

const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const gateCommands = gates.flatMap((gate) =>
  typeof gate.run === "string" ? [gate.run.replace(/^pnpm run (--if-present )?/, "pnpm ")] : [],
);
for (const script of Object.keys(scripts)) {
  if (!/^(check|typecheck):/.test(script) || POST_BUILD_CHECKS.includes(script)) continue;
  if (
    !gateCommands.some((command) => command.split(" ").slice(0, 2).join(" ") === `pnpm ${script}`)
  ) {
    failures.push({
      kind: "script-not-a-gate",
      detail: `package.json script "${script}" is not a static gate, so neither CI nor \`pnpm verify:static\` runs it. Add { name, run: "pnpm ${script}" } to scripts/gates.mjs, or, if it needs \`pnpm build\` first, add "${script}" to POST_BUILD_CHECKS in scripts/lib/workflow-coverage.ts and run it after the build step in ${WORKFLOW}.`,
    });
  }
}

if (failures.length > 0) {
  console.error(
    `❌ Checks-coverage failed (${failures.length} gap${failures.length === 1 ? "" : "s"}):\n`,
  );
  for (const f of failures) {
    console.error(`  [${f.kind}] ${f.detail}`);
  }
  process.exit(1);
}

console.log(
  `✓ Checks covered: ${areas.length} declared test areas ` +
    `owning ${ownedRoots.length} source roots, all present on disk; ` +
    `${gates.length} static gates in ${GATE_JOBS.length} jobs, each run once by ${WORKFLOW}, ` +
    `every job timed against its budget.`,
);
process.exit(0);
