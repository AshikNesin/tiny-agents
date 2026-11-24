#!/usr/bin/env tsx
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKFLOWS_DIR = ".github/workflows";
const USES = new RegExp(String.raw`^\s*-?\s*uses:\s*([\w.-]+/[\w.-]+)@([^\s#]+)\s*(#.*)?$`);
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const FIX =
  "pin it to the full commit SHA the tag points at, with the version in a comment (`@<sha> # v5.1.0`).";

export function actionPinningProblems(files: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, source] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    source.split("\n").forEach((line, index) => {
      const match = USES.exec(line);
      if (!match) return;
      const [, action, ref] = match;
      if (COMMIT_SHA.test(ref!)) return;
      problems.push(`${file}:${index + 1} uses ${action}@${ref}: ${FIX}`);
    });
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = path.join(root, WORKFLOWS_DIR);
  const files = Object.fromEntries(
    readdirSync(dir)
      .filter((file) => /\.ya?ml$/.test(file))
      .map((file) => [`${WORKFLOWS_DIR}/${file}`, readFileSync(path.join(dir, file), "utf8")]),
  );
  const problems = actionPinningProblems(files);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(`action pinning: every action in ${WORKFLOWS_DIR} is pinned to a commit SHA`);
}
