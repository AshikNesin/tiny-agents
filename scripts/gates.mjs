#!/usr/bin/env node
// The static gates, in the order the Tests workflow runs them. The workflow
// calls `pnpm verify:static`, so a gate added here runs locally and in CI;
// `pnpm check:coverage` fails when a static check runs anywhere else.
//
// Usage: pnpm verify:static (stops at the first failing gate and names it)

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const MIGRATIONS_DIR = "apps/web/drizzle";

export const gates = [
  { name: "Typecheck (server)", run: "pnpm exec tsc --noEmit" },
  { name: "Typecheck (client)", run: "pnpm typecheck:client" },
  { name: "Typecheck coverage", run: "pnpm exec tsx scripts/check-typecheck-coverage.ts" },
  { name: "Typecheck kit consumers", run: "pnpm typecheck:kit" },
  { name: "Kit export guard", run: "pnpm exec tsx scripts/check-kit-exports.ts" },
  { name: "Changeset gate", run: "pnpm check:changesets --base origin/${GITHUB_BASE_REF:-main}" },
  { name: "Checks coverage", run: "pnpm check:coverage" },
  { name: "Lint & format check", run: "pnpm check" },
  { name: "Design tokens", run: "pnpm check:tokens" },
  { name: "Migrations are up to date with the schema", run: migrationsMatchSchema },
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

// Generates a migration and compares the folder before and after, then puts
// back what it found, so a local run neither trips on an uncommitted
// migration nor leaves a ci-check migration behind.
function migrationsMatchSchema() {
  const before = readTree(MIGRATIONS_DIR);
  if (!sh("pnpm db:generate --name ci-check")) return false;
  const after = readTree(MIGRATIONS_DIR);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  );
  for (const file of changed) {
    if (before.has(file)) writeFileSync(file, before.get(file));
    else unlinkSync(file);
  }
  if (changed.length === 0) return true;
  console.error(
    `Schema changed without a migration. Run 'pnpm db:generate' and commit ${MIGRATIONS_DIR}.`,
  );
  for (const file of changed) console.error(`  ${file}`);
  return false;
}

function runGates() {
  const inActions = process.env.GITHUB_ACTIONS === "true";
  for (const gate of gates) {
    console.log(inActions ? `::group::${gate.name}` : `\n▶ ${gate.name}`);
    const started = performance.now();
    const passed = typeof gate.run === "function" ? gate.run() : sh(gate.run);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (inActions) console.log("::endgroup::");
    if (!passed) {
      const rerun = typeof gate.run === "string" ? ` Rerun it alone with: ${gate.run}` : "";
      console.error(`${inActions ? "::error::" : ""}✗ ${gate.name} failed (${seconds}s).${rerun}`);
      process.exit(1);
    }
    console.log(`✓ ${gate.name} (${seconds}s)`);
  }
  console.log(`\nAll ${gates.length} static gates passed.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) runGates();
