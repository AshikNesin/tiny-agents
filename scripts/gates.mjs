// The static gates: one list for `pnpm verify:static` (every gate) and for CI,
// where each gate runs in the job its `job` names (`pnpm verify:static --job
// <job>`, one workflow job each; `pnpm check:coverage` holds the workflow to
// this list). A gate added here runs locally and in CI.
//
// Gates run in parallel, as many at once as the machine has cores, each with
// its output held back and printed whole when it ends. An `exclusive` gate
// runs alone, after the rest: the migration freshness gate rewrites
// apps/web/drizzle while it runs.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MIGRATIONS_DIR = "apps/web/drizzle";

/** The CI jobs, in the order a summary lists them. */
export const GATE_JOBS = ["typecheck", "lint", "gates", "migrations"];

export const gates = [
  { name: "Typecheck (server)", job: "typecheck", run: "pnpm exec tsc --noEmit" },
  { name: "Typecheck (client)", job: "typecheck", run: "pnpm typecheck:client" },
  { name: "Typecheck (e2e tests)", job: "typecheck", run: "pnpm typecheck:e2e" },
  { name: "Typecheck kit consumers", job: "typecheck", run: "pnpm typecheck:kit" },
  // A child's own tsconfigs (e.g. a Workers test suite); groot defines none.
  {
    name: "Typecheck (app projects)",
    job: "typecheck",
    run: "pnpm run --if-present typecheck:app",
  },
  { name: "Lint & format check", job: "lint", run: "pnpm check" },
  {
    name: "Typecheck coverage",
    job: "gates",
    run: "pnpm exec tsx scripts/check-typecheck-coverage.ts",
  },
  {
    name: "Kit export guard",
    job: "gates",
    run: "pnpm exec tsx scripts/check-kit-exports.ts --base origin/${GITHUB_BASE_REF:-main}",
  },
  {
    name: "Changeset gate",
    job: "gates",
    run: "pnpm check:changesets --base origin/${GITHUB_BASE_REF:-main}",
  },
  { name: "Checks coverage", job: "gates", run: "pnpm check:coverage" },
  { name: "Doc references", job: "gates", run: "pnpm check:doc-refs" },
  { name: "Rule table", job: "gates", run: "pnpm exec tsx scripts/check-rule-table.ts" },
  { name: "Dead code", job: "gates", run: "pnpm check:dead" },
  { name: "Design tokens", job: "gates", run: "pnpm check:tokens" },
  { name: "pnpm policy", job: "gates", run: "pnpm check:pnpm-policy" },
  { name: "Old modules", job: "gates", run: "pnpm check:old-modules" },
  {
    name: "Migrations are up to date with the schema",
    job: "migrations",
    exclusive: true,
    run: migrationsMatchSchema,
  },
  {
    name: "Applied migrations unchanged",
    job: "migrations",
    exclusive: true,
    run: "pnpm check:migrations-immutable --base origin/${GITHUB_BASE_REF:-main}",
  },
];

function sh(command) {
  return spawnSync(command, { shell: true, stdio: "inherit" }).status === 0;
}

function readTree(dir) {
  return new Map(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [file, readFileSync(file, "utf8")];
      }),
  );
}

function restoreTree(dir, before) {
  const after = readTree(dir);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  );
  for (const file of changed) {
    if (before.has(file)) writeFileSync(file, before.get(file));
    else unlinkSync(file);
  }
  return changed;
}

function migrationsMatchSchema() {
  const before = readTree(MIGRATIONS_DIR);
  const generated = sh("pnpm db:generate --name ci-check");
  const changed = restoreTree(MIGRATIONS_DIR, before);
  if (!generated) return false;
  if (changed.length === 0) return true;
  console.error(
    `Schema changed without a migration. Run 'pnpm db:generate' and commit ${MIGRATIONS_DIR}.`,
  );
  for (const file of changed) console.error(`  ${file}`);
  return false;
}

/** Run one gate, its output held back: resolves `{ passed, output, seconds }`. */
function runGate(gate) {
  const started = performance.now();
  const done = (passed, output) => ({
    passed,
    output,
    seconds: (performance.now() - started) / 1000,
  });
  if (typeof gate.run === "function") {
    // In-process gates print as they go; they run alone (`exclusive`).
    return Promise.resolve(done(gate.run(), ""));
  }
  return new Promise((resolve) => {
    const child = spawn(gate.run, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (code) => resolve(done(code === 0, Buffer.concat(chunks).toString())));
  });
}

/** Run `list` with at most `limit` at once, in order of start; resolves results in list order. */
async function pool(list, limit, run) {
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const at = next++;
      results[at] = await run(list[at]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}

/** The gates `pnpm verify:static [--job <job>]` runs, or a reason the job is unknown. */
export function selectGates(argv) {
  const at = argv.indexOf("--job");
  if (at === -1) return { gates };
  const job = argv[at + 1];
  if (!GATE_JOBS.includes(job)) {
    return { error: `Unknown gate job "${job}". Jobs: ${GATE_JOBS.join(", ")}.` };
  }
  return { gates: gates.filter((gate) => gate.job === job) };
}

async function runGates() {
  const inActions = process.env.GITHUB_ACTIONS === "true";
  const selected = selectGates(process.argv.slice(2));
  if (selected.error) {
    console.error(selected.error);
    process.exit(2);
  }
  const report = (gate, result) => {
    console.log(inActions ? `::group::${gate.name}` : `\n▶ ${gate.name}`);
    if (result.output) process.stdout.write(result.output);
    if (inActions) console.log("::endgroup::");
    const seconds = result.seconds.toFixed(1);
    if (result.passed) {
      console.log(`✓ ${gate.name} (${seconds}s)`);
      return;
    }
    const rerun = typeof gate.run === "string" ? ` Rerun it alone with: ${gate.run}` : "";
    console.error(`${inActions ? "::error::" : ""}✗ ${gate.name} failed (${seconds}s).${rerun}`);
  };
  const together = selected.gates.filter((gate) => !gate.exclusive);
  const alone = selected.gates.filter((gate) => gate.exclusive);
  const results = await pool(together, availableParallelism(), async (gate) => {
    const result = await runGate(gate);
    report(gate, result);
    return result;
  });
  for (const gate of alone) {
    const result = await runGate(gate);
    report(gate, result);
    results.push(result);
  }
  const failed = results.filter((result) => !result.passed).length;
  if (failed > 0) {
    console.error(`\n${failed} of ${results.length} static gates failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} static gates passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await runGates();
