#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { BASELINE_PATH, countComments, inScope, readBaseline } from "./lint/comments.mjs";

type Baseline = Record<string, number>;

export function ratchetProblems(
  actual: Baseline,
  baseline: Baseline,
  base: Baseline | null,
  baselinePath = BASELINE_PATH,
) {
  const problems: string[] = [];
  for (const [file, count] of Object.entries(actual)) {
    const allowed = baseline[file] ?? 0;
    if (count > allowed) {
      problems.push(
        `${file}: ${count} comments, the ratchet allows ${allowed}. R16 bans new comments (ADR 0028): name the why in code, or record a decision in an ADR.`,
      );
    }
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    if ((actual[file] ?? 0) < allowed) {
      problems.push(
        `${file}: the ratchet allows ${allowed} comments but the file has ${actual[file] ?? 0}. Run 'pnpm comments:ratchet' to lock in the cut.`,
      );
    }
  }
  if (base) {
    let added = 0;
    let freed = 0;
    for (const [file, allowed] of Object.entries(baseline)) {
      if (file in base) {
        if (allowed > base[file]) {
          problems.push(
            `${file}: the ratchet grew from ${base[file]} to ${allowed}. It only shrinks.`,
          );
        }
      } else added += allowed;
    }
    for (const [file, allowed] of Object.entries(base)) if (!(file in baseline)) freed += allowed;
    if (added > freed) {
      problems.push(
        `${baselinePath} gives new paths ${added} but frees only ${freed}. A rename may carry its count; a new file starts at 0.`,
      );
    }
  }
  return problems;
}

async function actualCounts() {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && inScope(file) && existsSync(file));
  const counts: Baseline = {};
  for (const file of files.toSorted()) {
    const count = await countComments(file, readFileSync(file, "utf8"));
    if (count > 0) counts[file] = count;
  }
  return counts;
}

function baseBaseline(ref: string | undefined): Baseline | null {
  if (!ref) return null;
  try {
    return readBaseline(
      execFileSync("git", ["show", `${ref}:${BASELINE_PATH}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

const total = (counts: Baseline) => Object.values(counts).reduce((sum, n) => sum + n, 0);

async function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const actual = await actualCounts();
  const baseline: Baseline = existsSync(BASELINE_PATH) ? readBaseline() : {};

  if (args.includes("--write")) {
    const tightened: Baseline = {};
    for (const [file, allowed] of Object.entries(baseline)) {
      const count = Math.min(allowed, actual[file] ?? 0);
      if (count > 0) tightened[file] = count;
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(tightened, null, 2)}\n`);
    console.log(`comment ratchet: ${total(baseline)} -> ${total(tightened)} allowed comments`);
    return;
  }

  const problems = ratchetProblems(
    actual,
    baseline,
    baseBaseline(baseIndex >= 0 ? args[baseIndex + 1] : undefined),
  );
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log(
    `comment ratchet: ${total(actual)} comments left in ${Object.keys(actual).length} files`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
