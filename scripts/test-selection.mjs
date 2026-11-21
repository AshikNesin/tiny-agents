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
  /^(?!mobile\/)(.*\/)?package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig[^/]*\.json$/,
  /^\.github\/workflows\/test\.yml$/,
  /^\.github\/actions\//,
  /^scripts\/test-selection\.mjs$/,
];

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
