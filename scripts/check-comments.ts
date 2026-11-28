#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { countComments, inScope } from "./lint/comments.mjs";

export function commentProblems(counts: Readonly<Record<string, number>>): string[] {
  return Object.entries(counts).map(
    ([file, count]) =>
      `${file}: ${count} comments. Code carries no comments (ADR 0028): say it in a name, a type or a test, and record a decision in docs/adr/.`,
  );
}

async function commentCounts(): Promise<Record<string, number>> {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && inScope(file) && existsSync(file));
  const counts: Record<string, number> = {};
  for (const file of files.toSorted()) {
    const count = await countComments(file, readFileSync(file, "utf8"));
    if (count > 0) counts[file] = count;
  }
  return counts;
}

async function main() {
  const counts = await commentCounts();
  const problems = commentProblems(counts);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log("comments: none in scope");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
