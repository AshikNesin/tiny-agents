#!/usr/bin/env tsx
/**
 * Checks-coverage guard for the declared test ownership in
 * `.groot/lib/patterns.ts` (TEST_AREA_OWNERSHIP).
 *
 * Catches the two ways that map silently stops guarding:
 *
 *  1. An owned source root stops existing (renamed or deleted), so the map
 *     claims ownership of source that is no longer there.
 *  2. A declared test area stops existing or holds no tests. A renamed test
 *     area silently unschedules every suite under it — those tests fall to
 *     drift in sync — and nothing turns red.
 *
 * It also holds the static gates to one list, `scripts/gates.mjs`, so local
 * runs and CI can't drift apart:
 *
 *  3. The Tests workflow runs each gate job of gates.mjs in one step
 *     (`pnpm verify:static --job <job>`) and no other static check, every
 *     job checks its time budget, and every test shard runs
 *     (scripts/lib/workflow-coverage.ts).
 *  4. Every `check:*` and `typecheck:*` package script is a gate, or a check
 *     the workflow runs after the build.
 *
 * Usage:  tsx scripts/check-checks-coverage.ts
 * Exit:   0 = covered, 1 = stale ownership entry or a check outside the gates.
 */
import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { load as loadYaml } from "js-yaml";
import micromatch from "micromatch";
import { loadConfig } from "../.groot/lib/config";
import { ownedSourceRootsForTests, TEST_AREA_OWNERSHIP } from "../.groot/lib/patterns";
import { GATE_JOBS, gates } from "./gates.mjs";
import { RUN_BUDGETS } from "./ci-budget.mjs";
import { workflowProblems, type Workflow } from "./lib/workflow-coverage";

const ROOT = new URL("..", import.meta.url).pathname;

const { additional_exclusions } = await loadConfig(ROOT);
const excludedFromSync = (dirOrRoot: string) =>
  micromatch.isMatch(dirOrRoot.replace(/\/\*\*$/, ""), additional_exclusions);

/** Expand a root pattern (may contain one `*` segment) to the dirs that exist. */
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

// --- 1. Owned source roots (what the synced test areas own) exist. --------
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

// --- 2. Every declared ownership area exists on disk and holds at least one
// test. Counting a test file (not "any file") keeps an area from being kept
// alive by its setup files alone.
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

// --- 3. The Tests workflow runs every gate once, times every job, drops no shard.
const WORKFLOW = ".github/workflows/test.yml";
// Need `pnpm build` first: the closure reads the server bundle's metafile, and the
// wrangler dry run uploads dist/client as the Worker's assets.
const POST_BUILD_CHECKS = ["check:closure", "check:worker"];
for (const detail of workflowProblems({
  file: WORKFLOW,
  workflow: loadYaml(readFileSync(join(ROOT, WORKFLOW), "utf8")) as Workflow,
  gateJobs: GATE_JOBS,
  runBudgets: RUN_BUDGETS,
  postBuildChecks: POST_BUILD_CHECKS,
})) {
  failures.push({ kind: "workflow", detail });
}

// --- 4. Every check script is a gate. --------------------------------------
const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
// `pnpm run --if-present x` runs script x, like `pnpm x`.
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
      detail: `package.json script "${script}" is not a static gate, so neither CI nor \`pnpm verify:static\` runs it. Add { name, run: "pnpm ${script}" } to scripts/gates.mjs, or, if it needs \`pnpm build\` first, add "${script}" to POST_BUILD_CHECKS in scripts/check-checks-coverage.ts and run it after the build step in ${WORKFLOW}.`,
    });
  }
}

// --- Report. --------------------------------------------------------------
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
