import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const SCRIPT = "scripts/delete-merged-branches.sh";
const ID = ["-c", "user.email=t@example.com", "-c", "user.name=t"];

let dir: string;
let work: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();

function branch(name: string) {
  git(work, "checkout", "-q", "-B", "scratch", "main");
  git(work, ...ID, "commit", "-q", "--allow-empty", "-m", `work on ${name}`);
  git(work, "checkout", "-q", "main");
  git(work, "push", "-q", "origin", `scratch:refs/heads/${name}`);
}

function mergeIntoMain(name: string) {
  git(work, "fetch", "-q", "origin");
  git(work, "checkout", "-q", "main");

  git(work, ...ID, "merge", "-q", "--no-ff", "-m", `Merge ${name}`, `origin/${name}`);
  git(work, "push", "-q", "origin", "main");
}

function runIn(cwd: string, ...protectedNames: string[]) {
  const options = {
    cwd,
    encoding: "utf8" as const,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  };
  try {
    const out = execFileSync("bash", [path.resolve(SCRIPT), ...protectedNames], options);
    return { lines: out.trim().split("\n").filter(Boolean), ok: true };
  } catch (error) {
    const failed = error as { stdout?: string };
    return { lines: (failed.stdout ?? "").trim().split("\n").filter(Boolean), ok: false };
  }
}

const run = (...protectedNames: string[]) => runIn(work, ...protectedNames);

const remoteBranches = () =>
  git(work, "branch", "-r", "--format", "%(refname)")
    .split("\n")

    .map((ref) => ref.replace(/^refs\/remotes\/origin\//, ""))
    .filter((name) => name !== "HEAD" && name !== "main")
    .sort();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "groot-branches-"));
  const origin = path.join(dir, "origin.git");
  work = path.join(dir, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, work], { stdio: "ignore" });
  git(work, ...ID, "commit", "-q", "--allow-empty", "-m", "c1");
  git(work, "push", "-q", "origin", "main");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("delete-merged-branches.sh", () => {
  it("deletes a merged branch and keeps an unmerged one", () => {
    branch("merged");
    branch("in-progress");
    mergeIntoMain("merged");

    const result = run();

    expect(result).toEqual({ lines: ["kept main default", "deleted merged"], ok: true });
    expect(remoteBranches()).toEqual(["in-progress"]);
  });

  it("deletes a branch whose name starts with a dash, which git would otherwise read as an option", () => {
    branch("-lead");
    mergeIntoMain("-lead");

    expect(run()).toEqual({
      lines: expect.arrayContaining(["kept main default", "deleted -lead"]),
      ok: true,
    });
    expect(remoteBranches()).toEqual([]);
  });

  it("reads one branch per line, so names need no word splitting or globbing", () => {
    const names = [
      "release/1.0",
      "feature/emoji-🚀",
      "ünïcödé",
      "a.b.c",
      "2fa",
      "dependabot/npm_and_yarn/x-1.2.3",
    ];
    for (const name of names) branch(name);
    for (const name of names) mergeIntoMain(name);

    const result = run();
    expect(result.ok).toBe(true);
    expect(result.lines.filter((line) => line !== "kept main default").sort()).toEqual(
      names.map((name) => `deleted ${name}`).sort(),
    );
    expect(remoteBranches()).toEqual([]);
  });

  it("keeps the default branch, the built-in protected names and extra ones given as arguments", () => {
    for (const name of ["master", "develop", "staging", "release-1.0", "plain"]) branch(name);
    for (const name of ["master", "develop", "staging", "release-1.0", "plain"])
      mergeIntoMain(name);

    const result = run("release-1.0");

    const outcomes = Object.fromEntries(
      result.lines.map((line) => {
        const [verb, name] = line.split(" ");
        return [name, verb];
      }),
    );
    expect(outcomes).toEqual({
      main: "kept",
      master: "kept",
      develop: "kept",
      staging: "kept",
      "release-1.0": "kept",
      plain: "deleted",
    });

    expect(result.lines).toEqual(
      expect.arrayContaining([
        "kept main default",
        "kept master protected",
        "kept develop protected",
        "kept staging protected",
        "kept release-1.0 protected",
      ]),
    );
    expect(result.ok).toBe(true);
    expect(remoteBranches()).toEqual(["develop", "master", "release-1.0", "staging"]);
  });

  it("keeps a branch whose tip is the default branch's tip", () => {
    git(work, "push", "-q", "origin", "main:refs/heads/just-created");

    expect(run()).toEqual({
      lines: expect.arrayContaining(["kept main default", "kept just-created at-default-tip"]),
      ok: true,
    });
    expect(remoteBranches()).toEqual(["just-created"]);
  });

  it("exits non-zero when the default branch cannot be determined, touching nothing", () => {
    const empty = path.join(dir, "empty.git");
    execFileSync("git", ["init", "-q", "--bare", empty]);
    execFileSync("git", ["clone", "-q", empty, path.join(dir, "empty-work")], { stdio: "ignore" });
    const result = runIn(path.join(dir, "empty-work"));

    expect(result).toEqual({ lines: [], ok: false });
    expect(git(path.join(dir, "empty-work"), "ls-remote", "--heads", "origin")).toBe("");
  });
});
