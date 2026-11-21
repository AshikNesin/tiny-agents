import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ZERO = /^0+$/;
const FORMATTED = /\.(?:[cm]?[jt]sx?|json|jsonc|ya?ml|md|css|html)$/;
const LINTED = /\.(?:[cm]?[jt]sx?)$/;
const TYPED = /\.(?:[cm]?tsx?)$|(?:^|\/)(?:tsconfig[^/]*\.json|package\.json)$/;

export function prePushPlan(files, removed = []) {
  return {
    fmt: files.filter((file) => FORMATTED.test(file) && file !== "pnpm-lock.yaml"),
    lint: files.filter((file) => LINTED.test(file)),
    typecheck: [...files, ...removed].some((file) => TYPED.test(file)),
  };
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();

function quietly(...args) {
  try {
    return git(...args);
  } catch {
    return "";
  }
}

function changedFiles(refLines) {
  const files = new Set();
  const removed = new Set();
  for (const line of refLines) {
    const [localRef, localSha, , remoteSha] = line.split(" ");
    if (!localSha || localRef.startsWith("refs/tags/") || ZERO.test(localSha)) continue;
    const base =
      remoteSha && !ZERO.test(remoteSha) && quietly("cat-file", "-t", remoteSha) === "commit"
        ? remoteSha
        : quietly("merge-base", localSha, "origin/main");
    const listed = base
      ? quietly("diff", "--name-only", "--no-renames", base, localSha)
      : quietly("ls-files");
    for (const file of listed.split("\n")) {
      if (!file) continue;
      if (existsSync(file)) files.add(file);
      else removed.add(file);
    }
  }
  return { files: [...files], removed: [...removed] };
}

function run(name, command, args) {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (code) => {
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      if (code !== 0) process.stdout.write(Buffer.concat(chunks));
      console.log(`${code === 0 ? "✓" : "✗"} ${name} (${seconds}s)`);
      resolve(code === 0);
    });
  });
}

async function main() {
  const refLines = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const { files, removed } = changedFiles(refLines);
  if (files.length === 0 && removed.length === 0) return;
  const plan = prePushPlan(files, removed);
  const checks = [run("Merges with main", "node", ["scripts/check-merge-main.mjs"])];
  if (plan.fmt.length > 0) {
    checks.push(
      run(`Format (${plan.fmt.length} files)`, "vp", [
        "fmt",
        "--check",
        "--no-error-on-unmatched-pattern",
        ...plan.fmt,
      ]),
    );
  }
  if (plan.lint.length > 0) {
    checks.push(run(`Lint (${plan.lint.length} files)`, "vp", ["lint", ...plan.lint]));
  }
  if (plan.typecheck) {
    checks.push(
      run("Typecheck (incremental)", "node", ["scripts/gates.mjs", "--job", "typecheck"]),
    );
  }
  const passed = await Promise.all(checks);
  if (passed.includes(false)) {
    console.error("pre-push: fix the above, or see docs/guides/precommit-hooks.md.");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
