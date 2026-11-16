/**
 * The workspace module (issue #297 §6, §7.3) on real git: worktrees per
 * thread, diffs against the base branch, sync to the remote head, and the
 * push rules (never forced, hooks off, the token only on stdin).
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  branchName,
  createWorkspace,
  matchesGlob,
  WorkspaceError,
  type Workspace,
} from "../../../../apps/web/src/server/api/code/code.workspace";
import { bareRepo, localExec, sh, type LocalExec } from "./local-exec";

const repo = { owner: "acme", name: "web" };
let local: LocalExec;
let bare: string;
let ws: Workspace;
let checkout: string;

beforeEach(async () => {
  local = localExec();
  bare = await bareRepo(local);
  ws = createWorkspace({ exec: local.exec, credential: { kind: "gh" }, remoteUrl: () => bare });
  checkout = join(local.home, "projects", "web", "checkout");
  await ws.clone(repo, checkout);
});

afterEach(() => local.cleanup());

describe("worktrees", () => {
  it("gives two threads in one project their own branch and files", async () => {
    const a = join(local.home, "projects", "web", "a");
    const b = join(local.home, "projects", "web", "b");
    const baseA = await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await ws.addWorktree(checkout, b, "ta/b-2", "main");
    await sh(local, `cd ${a} && printf 'from a\\n' > README.md`);

    expect(baseA).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(join(b, "README.md"), "utf8")).toBe("hello\n");
    expect(await sh(local, `git -C ${b} rev-parse --abbrev-ref HEAD`)).toBe("ta/b-2");
    expect(await ws.uncommitted(a)).toEqual([" M README.md"]);
    expect(await ws.uncommitted(b)).toEqual([]);
  });

  it("recreates a removed worktree from its branch (archive, then unarchive)", async () => {
    const a = join(local.home, "projects", "web", "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(
      local,
      `cd ${a} && printf 'x\\n' > new.txt && git add -A && git commit --quiet -m work`,
    );
    await ws.removeWorktree(checkout, a);
    expect(existsSync(a)).toBe(false);

    await ws.addWorktreeForBranch(checkout, a, "ta/a-1");
    expect(readFileSync(join(a, "new.txt"), "utf8")).toBe("x\n");
  });
});

describe("diffs against the base branch", () => {
  it("lists committed and uncommitted changes since the merge base, with content hashes", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(
      local,
      `cd ${a} && printf 'export const b = 2;\\n' > src/b.ts && git add -A && git commit --quiet -m b && printf 'hello\\nworld\\n' > README.md && git rm --quiet src/a.ts`,
    );

    const files = await ws.baseFiles(a, "main");
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["README.md", "modified", 1, 0],
      ["src/a.ts", "deleted", 0, 1],
      ["src/b.ts", "added", 1, 0],
    ]);
    expect(files.find((f) => f.path === "src/a.ts")?.hash).toBe("deleted");
    expect(files.find((f) => f.path === "README.md")?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await ws.baseFile(a, "main", "README.md")).toEqual({
      oldContent: "hello\n",
      newContent: "hello\nworld\n",
    });
    expect((await ws.commitsAhead(a, "main")).map((c) => c.subject)).toEqual(["b"]);
  });
});

describe("push", () => {
  async function worktree(name: string, branch: string) {
    const path = join(local.home, name);
    await ws.addWorktree(checkout, path, branch, "main");
    return path;
  }

  it("pushes HEAD to the branch and answers its sha", async () => {
    const a = await worktree("a", "ta/a-1");
    await sh(local, `cd ${a} && printf 'x\\n' > x.txt && git add -A && git commit --quiet -m x`);
    const sha = await ws.push(a, repo, "ta/a-1");
    expect(await sh(local, `git -C ${bare} rev-parse refs/heads/ta/a-1`)).toBe(sha);
  });

  it("is rejected, never forced, when someone else pushed first", async () => {
    const a = await worktree("a", "ta/a-1");
    await sh(local, `cd ${a} && printf '1\\n' > x.txt && git add -A && git commit --quiet -m one`);
    await ws.push(a, repo, "ta/a-1");
    // Someone pushes to the branch from elsewhere.
    const other = await worktree("other", "other");
    await sh(
      local,
      `cd ${other} && git fetch --quiet ${bare} ta/a-1 && git reset --quiet --hard FETCH_HEAD && printf '2\\n' > y.txt && git add -A && git commit --quiet -m theirs && git push --quiet ${bare} HEAD:refs/heads/ta/a-1`,
    );
    const theirs = await sh(local, `git -C ${bare} rev-parse refs/heads/ta/a-1`);
    await sh(local, `cd ${a} && printf '3\\n' > z.txt && git add -A && git commit --quiet -m mine`);

    const error = await ws.push(a, repo, "ta/a-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkspaceError);
    expect((error as WorkspaceError).code).toBe("rejected");
    expect(await sh(local, `git -C ${bare} rev-parse refs/heads/ta/a-1`)).toBe(theirs);
  });

  it("never runs a pre-push hook the agent wrote", async () => {
    const a = await worktree("a", "ta/a-1");
    const marker = join(local.home, "hook-ran");
    await sh(
      local,
      `printf '#!/bin/sh\\ntouch ${marker}\\n' > ${checkout}/.git/hooks/pre-push && chmod +x ${checkout}/.git/hooks/pre-push && git -C ${a} config core.hooksPath ${checkout}/.git/hooks`,
    );
    await sh(local, `cd ${a} && printf 'x\\n' > x.txt && git add -A && git commit --quiet -m x`);
    await ws.push(a, repo, "ta/a-1");
    expect(existsSync(marker)).toBe(false);
  });

  it("hands a vault token to the command on stdin, never on its command line", async () => {
    const withToken = createWorkspace({
      exec: local.exec,
      credential: { kind: "token", token: async () => "ghs_secret_value" },
      remoteUrl: () => bare,
    });
    const a = await worktree("a", "ta/a-1");
    await sh(local, `cd ${a} && printf 'x\\n' > x.txt && git add -A && git commit --quiet -m x`);
    local.calls.length = 0;
    await withToken.push(a, repo, "ta/a-1");

    const push = local.calls.find((c) => c.command.includes(" push "))!;
    expect(push.stdin).toBe("ghs_secret_value\n");
    expect(local.calls.some((c) => c.command.includes("ghs_secret_value"))).toBe(false);
  });
});

describe("sync to the remote head", () => {
  it("fast-forwards to commits pushed from elsewhere, and refuses when both moved", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(local, `cd ${a} && printf '1\\n' > x.txt && git add -A && git commit --quiet -m one`);
    await ws.push(a, repo, "ta/a-1");
    const b = join(local.home, "b");
    await ws.addWorktree(checkout, b, "elsewhere", "main");
    await sh(
      local,
      `cd ${b} && git fetch --quiet ${bare} ta/a-1 && git reset --quiet --hard FETCH_HEAD && printf '2\\n' > y.txt && git add -A && git commit --quiet -m two && git push --quiet ${bare} HEAD:refs/heads/ta/a-1`,
    );

    await ws.syncToRemote(a, repo, "ta/a-1");
    expect(readFileSync(join(a, "y.txt"), "utf8")).toBe("2\n");

    await sh(
      local,
      `cd ${b} && printf '3\\n' > z.txt && git add -A && git commit --quiet -m three && git push --quiet ${bare} HEAD:refs/heads/ta/a-1`,
    );
    await sh(local, `cd ${a} && printf '4\\n' > w.txt && git add -A && git commit --quiet -m four`);
    const error = await ws.syncToRemote(a, repo, "ta/a-1").catch((e: unknown) => e);
    expect((error as WorkspaceError).code).toBe("diverged");
  });

  it("does nothing for a branch not on the remote yet", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/new-1", "main");
    await expect(ws.syncToRemote(a, repo, "ta/new-1")).resolves.toBeUndefined();
  });
});

describe("names and paths", () => {
  it("makes branch names from a title", () => {
    expect(branchName("Fix the login flow!", "a1b2c3")).toBe("ta/fix-the-login-flow-a1b2c3");
    expect(branchName("   ", "a1b2c3")).toBe("ta/thread-a1b2c3");
  });

  it("matches protected paths by glob", () => {
    expect(matchesGlob(".github/workflows/ci.yml", ".github/workflows/**")).toBe(true);
    expect(matchesGlob(".github/CODEOWNERS", ".github/workflows/**")).toBe(false);
    expect(matchesGlob("src/a.ts", "src/*.ts")).toBe(true);
    expect(matchesGlob("src/deep/a.ts", "src/*.ts")).toBe(false);
  });
});

describe("the Thread-Id trailer", () => {
  it("adds the thread's trailer to every commit in its worktree, and still runs the repository's hooks", async () => {
    const a = join(local.home, "a");
    const b = join(local.home, "b");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await ws.addWorktree(checkout, b, "ta/b-1", "main");
    const marker = join(local.home, "pre-commit-ran");
    await sh(
      local,
      `printf '#!/bin/sh\\ntouch ${marker}\\n' > ${checkout}/.git/hooks/pre-commit && chmod +x ${checkout}/.git/hooks/pre-commit`,
    );
    await ws.installTrailer(a, join(local.home, "hooks", "a"), "Thread-Id: shelley:c1");

    await sh(
      local,
      `cd ${a} && printf 'x\\n' > x.txt && git add -A && git commit --quiet -m 'Fix it'`,
    );
    expect(await sh(local, `git -C ${a} log -1 --format=%B`)).toBe(
      "Fix it\n\nThread-Id: shelley:c1",
    );
    expect(existsSync(marker)).toBe(true);

    await sh(
      local,
      `cd ${b} && printf 'y\\n' > y.txt && git add -A && git commit --quiet -m 'Other'`,
    );
    expect(await sh(local, `git -C ${b} log -1 --format=%B`)).toBe("Other");
  });
});

describe("checkpoints", () => {
  it("records the worktree, uncommitted files included, without touching it, and restores it", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    const start = await ws.checkpoint(a, "refs/tiny-agents/checkpoints/a/0");
    await sh(
      local,
      `cd ${a} && printf 'hello\\nturn one\\n' > README.md && printf 'new\\n' > new.txt`,
    );
    const one = await ws.checkpoint(a, "refs/tiny-agents/checkpoints/a/1");
    // The worktree is as it was: nothing staged, nothing committed.
    expect(await ws.uncommitted(a)).toEqual([" M README.md", "?? new.txt"]);
    const head = await ws.headSha(a);

    expect((await ws.rangeFiles(a, start, one)).map((f) => [f.path, f.status])).toEqual([
      ["README.md", "modified"],
      ["new.txt", "added"],
    ]);
    expect(await ws.rangeFile(a, start, one, "README.md")).toEqual({
      oldContent: "hello\n",
      newContent: "hello\nturn one\n",
    });

    await sh(
      local,
      `cd ${a} && printf 'broken\\n' > README.md && rm new.txt && printf 'z\\n' > later.txt && git add -A && git commit --quiet -m later`,
    );
    await ws.restore(a, one);
    expect(readFileSync(join(a, "README.md"), "utf8")).toBe("hello\nturn one\n");
    expect(readFileSync(join(a, "new.txt"), "utf8")).toBe("new\n");
    expect(existsSync(join(a, "later.txt"))).toBe(false);
    // History is untouched: the restore is a change on top of it.
    expect(await sh(local, `git -C ${a} log -1 --format=%s`)).toBe("later");
    expect(await ws.headSha(a)).not.toBe(head);
  });
});
