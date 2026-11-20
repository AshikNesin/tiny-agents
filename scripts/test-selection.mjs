// Which tests a CI test job runs. Pull requests run only the test files the
// diff can reach (Vitest's --changed: the changed files and every test that
// imports them, directly or not); every other event (the merge queue, pushes
// to main and next, a manual run) runs everything. Selection only narrows PR
// feedback: the merge queue runs the full suite before anything reaches main.
//
// A change to anything the import graph cannot see runs everything on a PR
// too: the test setups and clock, the Vitest and Vite configs, the migrations
// and schemas, the package manifests and lockfile, the shared test fixtures
// and the CI wiring itself.
//
// Prints the extra Vitest arguments (nothing for a full run) and says why on
// stderr and in the job summary.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const RUN_EVERYTHING = [
  /^tests\/server\/setup\.ts$/,
  /^tests\/client\/setup\.ts$/,
  /^tests\/test-clock\.ts$/,
  /^tests\/sequencer\.ts$/,
  /^tests\/server\/fixtures\//,
  /^tests\/server\/helpers\.ts$/,
  /(^|\/)vitest\.config[^/]*\.ts$/,
  /(^|\/)vite\.config[^/]*\.ts$/,
  /^apps\/web\/drizzle\//,
  /(^|\/)schema\.ts$/,
  /(^|\/)package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig[^/]*\.json$/,
  /^\.github\/workflows\/test\.yml$/,
  /^\.github\/actions\//,
  /^scripts\/test-selection\.mjs$/,
];

/**
 * `{ args, reason }` for a CI event: `args` are what to add to the Vitest
 * command (empty for a full run).
 */
export function selection({ event, mergeBase, changedFiles }) {
  if (event !== "pull_request") {
    return { args: [], reason: `Full run: a ${event} event runs every test.` };
  }
  const trigger = changedFiles.find((file) => RUN_EVERYTHING.some((pattern) => pattern.test(file)));
  if (trigger) {
    return {
      args: [],
      reason: `Full run: ${trigger} changed, and the import graph cannot see what it affects.`,
    };
  }
  return {
    // A shard of a small selection may hold no file at all.
    args: [`--changed=${mergeBase}`, "--passWithNoTests"],
    reason: `Selected: test files the ${changedFiles.length} changed file(s) since ${mergeBase.slice(0, 7)} can reach. The merge queue runs everything.`,
  };
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? "local";
  let mergeBase = "";
  let changedFiles = [];
  if (event === "pull_request") {
    const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
    mergeBase = git("merge-base", `origin/${process.env.GITHUB_BASE_REF}`, "HEAD");
    changedFiles = git("diff", "--name-only", mergeBase, "HEAD").split("\n").filter(Boolean);
  }
  const { args, reason } = selection({ event, mergeBase, changedFiles });
  console.error(reason);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${reason}\n`);
  console.log(args.join(" "));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
