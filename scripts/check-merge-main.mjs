import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { mergeBase } from "./lib/merge-base.mjs";

const MIGRATIONS_DIR = "apps/web/drizzle/";
const ANDROID_DIR = "mobile/android/";
const VERSIONS = "mobile/android/version.properties";
const MOBILE_PACKAGE = "mobile/package.json";

const { values } = parseArgs({
  options: { base: { type: "string", default: "origin/main" }, root: { type: "string" } },
});
const ref = values.base;
const root = values.root ?? process.cwd();
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
const base = mergeBase(ref, root);

function updateCommand() {
  const slash = ref.indexOf("/");
  if (slash === -1) return `git merge ${ref}`;
  return `git fetch ${ref.slice(0, slash)} ${ref.slice(slash + 1)} && git merge ${ref}`;
}

function conflictProblems() {
  const run = git("merge-tree", "--write-tree", "--name-only", "--no-messages", ref, "HEAD");
  if (run.status === 0) return [];
  if (run.status !== 1) return [`git merge-tree ${ref} HEAD failed: ${run.stderr.trim()}`];
  const files = run.stdout.split("\n").slice(1).filter(Boolean);
  const lines = [
    `This branch conflicts with ${ref} in:`,
    ...files.map((file) => `  ${file}`),
    `Merge it now: \`${updateCommand()}\`, then resolve each file.`,
  ];
  if (files.some((file) => file.startsWith(MIGRATIONS_DIR))) {
    lines.push(
      `For a migration number taken on both sides, keep ${ref}'s migrations, delete this branch's, and rerun \`pnpm db:generate\`.`,
    );
  }
  if (files.includes(VERSIONS)) {
    lines.push(`For ${VERSIONS}, take ${ref}'s VERSION_CODE and set the next one.`);
  }
  return lines;
}

const property = (text, key) => new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1]?.trim();

function androidProblems() {
  const versionsFile = path.join(root, VERSIONS);
  if (!existsSync(versionsFile)) return [];
  const versions = readFileSync(versionsFile, "utf8");
  const problems = [];
  const name = property(versions, "VERSION_NAME");
  const packageFile = path.join(root, MOBILE_PACKAGE);
  if (existsSync(packageFile)) {
    const { version } = JSON.parse(readFileSync(packageFile, "utf8"));
    if (version !== name) {
      problems.push(
        `${MOBILE_PACKAGE} version is ${version} but ${VERSIONS} VERSION_NAME is ${name}. Set both to the release this change ships in.`,
      );
    }
  }
  const touched = git("diff", "--name-only", "--no-renames", base, "--", ANDROID_DIR).stdout.trim();
  if (!touched) return problems;
  const onMain = git("show", `${ref}:${VERSIONS}`);
  if (onMain.status !== 0) return problems;
  const mainCode = Number(property(onMain.stdout, "VERSION_CODE"));
  const code = Number(property(versions, "VERSION_CODE"));
  if (!(code > mainCode)) {
    problems.push(
      `This branch changes ${ANDROID_DIR}, and ${VERSIONS} VERSION_CODE is ${code}, ${code === mainCode ? "the same as" : "below"} ${ref}'s ${mainCode}. Set it to ${mainCode + 1}, bump VERSION_NAME and ${MOBILE_PACKAGE} to match, and add a mobile/CHANGELOG.md entry.`,
    );
  }
  return problems;
}

const problems = [...conflictProblems(), ...androidProblems()];
if (problems.length === 0) {
  console.log(`merge-main: HEAD merges cleanly with ${ref}`);
  process.exit(0);
}
for (const line of problems) console.error(line);
process.exit(1);
