#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { SILENT_FALLBACK_BASELINE } from "./lint/repo-plugin.mjs";

type Baseline = Record<string, Record<string, number>>;

const totals = (baseline: Baseline) => {
  const sum = new Map<string, number>();
  for (const sites of Object.values(baseline)) {
    for (const [site, count] of Object.entries(sites)) sum.set(site, (sum.get(site) ?? 0) + count);
  }
  return sum;
};

export function fallbackRatchetProblems(baseline: Baseline, base: Baseline | null): string[] {
  if (!base) return [];
  const before = totals(base);
  return [...totals(baseline)]
    .filter(([site, count]) => count > (before.get(site) ?? 0))
    .map(
      ([site, count]) =>
        `\`${site}\`: ${SILENT_FALLBACK_BASELINE} allows ${count}, up from ${before.get(site) ?? 0}. It only shrinks; a site that moves keeps its entry, and a changed one is new.`,
    );
}

function baseBaseline(ref: string): Baseline | null {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
  if (!git("ls-tree", "--name-only", ref, "--", SILENT_FALLBACK_BASELINE).trim()) return null;
  const base = JSON.parse(git("show", `${ref}:${SILENT_FALLBACK_BASELINE}`));
  return Object.values(base).every((value) => typeof value === "number") ? null : base;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const ref = args[args.indexOf("--base") + 1] ?? "origin/main";
  const problems = fallbackRatchetProblems(
    JSON.parse(readFileSync(SILENT_FALLBACK_BASELINE, "utf8")),
    baseBaseline(ref),
  );
  for (const problem of problems)
    console.error(`${problem} R17 lets old silent fallbacks stay only until they go.`);
  if (problems.length > 0) process.exit(1);
  console.log("silent fallback ratchet: no allowance grew");
}
