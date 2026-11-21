#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { ratchetProblems } from "./check-comment-ratchet";
import { SILENT_FALLBACK_BASELINE } from "./lint/repo-plugin.mjs";

type Baseline = Record<string, number>;

export function fallbackRatchetProblems(baseline: Baseline, base: Baseline | null): string[] {
  return ratchetProblems(baseline, baseline, base, SILENT_FALLBACK_BASELINE);
}

function baseBaseline(ref: string): Baseline | null {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
  if (!git("ls-tree", "--name-only", ref, "--", SILENT_FALLBACK_BASELINE).trim()) return null;
  return JSON.parse(git("show", `${ref}:${SILENT_FALLBACK_BASELINE}`));
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
