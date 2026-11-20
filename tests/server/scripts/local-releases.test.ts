import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  compare,
  fetchTracked,
  releaseInfo,
  releaseStore,
} from "../../../scripts/lib/local-releases";

let base: string;
let upstream: string;
let clone: string;

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(version: string, message: string, file = "app.txt"): string {
  writeFileSync(path.join(upstream, "package.json"), JSON.stringify({ version }));
  mkdirSync(path.dirname(path.join(upstream, file)), { recursive: true });
  writeFileSync(path.join(upstream, file), message);
  sh(upstream, "add", "-A");
  sh(upstream, "commit", "-q", "-m", message);
  return sh(upstream, "rev-parse", "HEAD");
}

let first: string;

beforeAll(() => {
  base = mkdtempSync(path.join(os.tmpdir(), "local-releases-"));
  upstream = path.join(base, "upstream");
  clone = path.join(base, "clone");
  mkdirSync(upstream);
  sh(upstream, "init", "-q", "-b", "main");
  sh(upstream, "config", "user.email", "test@example.com");
  sh(upstream, "config", "user.name", "Test");
  sh(upstream, "config", "commit.gpgsign", "false");
  first = commit("1.0.0", "first");
  sh(upstream, "tag", "v1.0.0");
  execFileSync("git", ["clone", "-q", upstream, clone]);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("local releases", () => {
  it("follows a branch and lists the commits an update brings", async () => {
    const second = commit("1.1.0", "second");
    const third = commit("1.1.0", "touch the sandbox", "docker/sandbox/Dockerfile");

    const head = await fetchTracked(clone, { kind: "branch", remote: "origin", branch: "main" });
    expect(head).toBe(third);

    expect(await releaseInfo(clone, head)).toMatchObject({
      sha: third,
      version: "1.1.0",
      subject: "touch the sandbox",
    });

    const update = await compare(clone, first, head);
    expect(update.commits.map((c) => c.subject)).toEqual(["touch the sandbox", "second"]);
    expect(update.sandboxChanged).toBe(true);
    expect(await compare(clone, first, second)).toMatchObject({ sandboxChanged: false });
    expect(await compare(clone, head, head)).toEqual({ commits: [], sandboxChanged: false });
  });

  it("follows the newest v* tag by version, not by name", async () => {
    commit("1.10.0", "ten");
    sh(upstream, "tag", "v1.10.0");
    const ten = sh(upstream, "rev-parse", "HEAD");
    commit("1.9.0", "nine");
    sh(upstream, "tag", "v1.9.0");
    commit("1.11.0", "unreleased");

    expect(await fetchTracked(clone, { kind: "release", remote: "origin" })).toBe(ten);
  });

  it("prunes every release worktree but the ones it keeps", async () => {
    const store = releaseStore(clone, path.join(base, "prune"));
    const keep = store.releaseDir("keep");
    const drop = store.releaseDir("drop");
    sh(clone, "worktree", "add", "-q", "--detach", keep, first);
    sh(clone, "worktree", "add", "-q", "--detach", drop, first);

    await store.prune(["keep"]);

    const listed = sh(clone, "worktree", "list", "--porcelain");
    expect(listed).toContain(keep);
    expect(listed).not.toContain(drop);
    expect(existsSync(drop)).toBe(false);
  });

  it("remembers only a release that finished building", () => {
    const store = releaseStore(clone, path.join(base, "releases"));
    expect(store.readCurrent()).toBeUndefined();
    store.saveCurrent(first);
    expect(store.readCurrent()).toBeUndefined();
    mkdirSync(store.releaseDir(first), { recursive: true });
    writeFileSync(path.join(store.releaseDir(first), ".tiny-agents-built"), "");
    expect(store.readCurrent()).toBe(first);
  });
});
