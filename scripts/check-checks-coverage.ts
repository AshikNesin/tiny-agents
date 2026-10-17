#!/usr/bin/env tsx
/**
 * Checks-coverage guard.
 *
 * Catches the two ways a root check silently stops guarding:
 *
 *  1. A new check (or a new package) appears, and its source list is
 *     hand-maintained in a script and duplicated in workflow `paths` filters.
 *     Both copies drift; this script fails when they disagree.
 *  2. A directory referenced by a workflow `paths` filter stops existing
 *     (renamed or deleted), so the job stops being scheduled for the very
 *     changes it guards, and nobody notices because nothing turns red.
 *     This covers the `dir/**` filter entries. Plain file-path entries
 *     (the checker scripts themselves) are guarded separately, in 3.
 *  3. A declared ownership area (or a checker script referenced by a
 *     workflow filter) stops existing. A renamed test area silently
 *     unschedules every suite under it — those tests fall to drift in sync
 *     — and a deleted checker script leaves filters that never match.
 *
 * The source roots come from one ownership map (`.groot/lib/patterns.ts`):
 * the UI roots the token checker scans, and the source roots the synced test
 * areas own. Adding a new package source root to the map is the single edit
 * that updates the token checker, the workflow filters, and this check
 * together.
 *
 * Usage:  tsx scripts/check-checks-coverage.ts
 * Exit:   0 = covered, 1 = coverage gap or stale workflow reference.
 */
import { readdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  uiSourceRoots,
  ownedSourceRootsForTests,
  TEST_AREA_OWNERSHIP,
} from "../.groot/lib/patterns";

const ROOT = new URL("..", import.meta.url).pathname;

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
  kind:
    | "stale-filter-dir"
    | "filter-misses-root"
    | "root-missing"
    | "area-missing"
    | "area-empty"
    | "checker-script-missing";
  detail: string;
}

const failures: Failure[] = [];

// --- 1. Every UI source root exists on disk and is covered by the workflow
// path filters of the token check. -----------------------------------------
const uiRoots = uiSourceRoots();
for (const root of uiRoots) {
  if (expandRoot(root).length === 0) {
    failures.push({
      kind: "root-missing",
      detail: `UI source root "${root}" (from .groot/lib/patterns.ts uiSourceRoots) matches no directory on disk. Update the map or restore the directory.`,
    });
  }
}

/** Workflow `paths` filters of the token check, parsed from the workflow file. */
function readTokenWorkflowPaths(): string[] {
  const file = join(ROOT, ".github/workflows/check-design-tokens.yml");
  const text = readFileSync(file, "utf-8");
  const paths: string[] = [];
  // `paths:` blocks appear once per trigger; collect every `- "..."` entry
  // that follows a `paths:` key until a non-list line.
  let inPaths = false;
  for (const raw of text.split("\n")) {
    if (/^\s*paths:\s*$/.test(raw)) {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const m = raw.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
      if (m) {
        paths.push(m[1]);
        continue;
      }
      inPaths = false;
    }
  }
  return [...new Set(paths)].sort();
}

const workflowPaths = readTokenWorkflowPaths();
for (const root of uiRoots) {
  if (!workflowPaths.includes(`${root}/**`)) {
    failures.push({
      kind: "filter-misses-root",
      detail: `UI source root "${root}" is missing from the check-design-tokens.yml path filters. The job will not run for changes in this root. Add "${root}/**" to both the push and pull_request paths.`,
    });
  }
}

// Every directory referenced by the token workflow's filters must exist on
// disk. A renamed or deleted directory leaves a filter that never matches,
// so the check stops being scheduled exactly where it is needed most.
const checkedDirs = workflowPaths.filter((p) => p.endsWith("/**")).map((p) => p.slice(0, -3));
for (const dir of checkedDirs) {
  if (expandRoot(dir).length === 0) {
    failures.push({
      kind: "stale-filter-dir",
      detail: `Workflow path filter "${dir}/**" matches no directory. Rename or delete the stale entry in .github/workflows/check-design-tokens.yml.`,
    });
  }
}

// --- 2. Owned source roots (what the synced test areas own) exist. --------
for (const root of ownedSourceRootsForTests()) {
  const dir = root.replace(/\/\*\*$/, "");
  if (expandRoot(dir).length === 0) {
    failures.push({
      kind: "root-missing",
      detail: `Owned source root "${root}" (from .groot/lib/patterns.ts TEST_AREA_OWNERSHIP) matches no directory on disk. Update the ownership map.`,
    });
  }
}

// --- 3. Every declared ownership area exists on disk and holds at least one
// test. A renamed test area (git mv tests/server/server tests/server/core)
// otherwise stays invisible to section 1: the workflow filters do not list
// test areas, so every suite under the renamed dir silently falls to drift in
// sync while nothing turns red. Counting a test file (not "any file") keeps
// an area from being kept alive by its setup files alone.
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

for (const area of Object.keys(TEST_AREA_OWNERSHIP)) {
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

// --- 4. Plain file-path filter entries (the checker scripts and map the
// workflows name by file) must exist. Unlike dir/** entries these are not
// caught by the stale-directory check, yet deleting one leaves a filter that
// never matches and a guard that stops being scheduled.
for (const entry of workflowPaths.filter((p) => !p.includes("*"))) {
  if (!existsSync(join(ROOT, entry))) {
    failures.push({
      kind: "checker-script-missing",
      detail: `Workflow path filter "${entry}" points at a file that does not exist. The guard that runs for changes to this file is no longer scheduled; fix the filter or restore the file.`,
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
  `✓ Checks covered: ${uiRoots.length} UI roots scanned by the token check, ` +
    `${Object.keys(TEST_AREA_OWNERSHIP).length} declared test areas, ` +
    `${workflowPaths.length} workflow path entries, all referencing existing paths.`,
);
process.exit(0);
