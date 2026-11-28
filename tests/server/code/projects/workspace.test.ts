import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createWorkspace,
  matchesGlob,
  WorkspaceError,
  type Workspace,
} from "../../../../apps/web/src/server/api/code/code.workspace";
import {
  branchSlug,
  cleanBranchSlug,
} from "../../../../apps/web/src/server/api/code/code.branches";
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

    const files = await ws.files(a, "merge-base:main");
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["README.md", "modified", 1, 0],
      ["src/a.ts", "deleted", 0, 1],
      ["src/b.ts", "added", 1, 0],
    ]);
    expect(files.find((f) => f.path === "src/a.ts")?.hash).toBe("deleted");
    expect(files.find((f) => f.path === "README.md")?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await ws.file(a, "README.md", "merge-base:main")).toEqual({
      oldContent: "hello\n",
      newContent: "hello\nworld\n",
    });
    expect((await ws.commitsAhead(a, "main")).map((c) => c.subject)).toEqual(["b"]);
  });

  it("lists a new file the agent has not committed, with its lines", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(local, `cd ${a} && mkdir -p src/new && printf 'one\\ntwo\\n' > src/new/c.ts`);

    const files = await ws.files(a, "merge-base:main");
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["src/new/c.ts", "added", 2, 0],
    ]);
    expect(files[0]?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await ws.file(a, "src/new/c.ts", "merge-base:main")).toEqual({
      oldContent: "",
      newContent: "one\ntwo\n",
    });
  });

  it("counts a renamed file's lines on both sides", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(local, `cd ${a} && git mv README.md DOCS.md && git commit --quiet -m mv`);

    const files = await ws.files(a, "merge-base:main");
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["DOCS.md", "added", 1, 0],
      ["README.md", "deleted", 0, 1],
    ]);
  });

  it("reads paths with spaces and non-ASCII characters as they are", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(
      local,
      `cd ${a} && printf 'x\\n' > "café notes.md" && git add -A && git commit --quiet -m cafe && printf 'y\\n' >> "café notes.md"`,
    );

    const files = await ws.files(a, "merge-base:main");
    expect(files.map((f) => [f.path, f.status, f.additions])).toEqual([
      ["café notes.md", "added", 2],
    ]);
    expect(files[0]?.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await ws.file(a, "café notes.md", "merge-base:main")).toEqual({
      oldContent: "",
      newContent: "x\ny\n",
    });
  });

  it("says a binary or oversized file cannot be shown instead of sending its bytes", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(
      local,
      `cd ${a} && printf 'PNG\\000\\001\\002' > logo.png && head -c 3000000 /dev/zero | tr '\\0' 'a' > big.txt`,
    );

    expect(await ws.file(a, "logo.png", "merge-base:main")).toEqual({
      oldContent: "",
      newContent: "",
      unshowable: "binary",
    });
    expect(await ws.file(a, "big.txt", "merge-base:main")).toEqual({
      oldContent: "",
      newContent: "",
      unshowable: "tooLarge",
    });
  });

  it("moves its change stamp on every write the Review panel shows, and only then", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(
      local,
      `cd ${a} && printf 'node_modules/\\n' > .gitignore && git add -A && git commit -qm ignore`,
    );
    await sh(local, `cd ${a} && printf 'one\\n' >> README.md`);
    const first = await ws.changeStamp(a);
    expect(await ws.changeStamp(a)).toBe(first);

    await sh(local, `cd ${a} && printf 'two\\n' >> README.md`);
    const second = await ws.changeStamp(a);
    expect(second).not.toBe(first);

    await sh(
      local,
      `cd ${a} && mkdir -p node_modules && printf 'x' > node_modules/x.js && touch src/a.ts`,
    );
    expect(await ws.changeStamp(a)).toBe(second);

    await sh(local, `cd ${a} && printf 'n\\n' > new.ts`);
    const third = await ws.changeStamp(a);
    expect(third).not.toBe(second);
    await sh(local, `cd ${a} && git add -A && git commit -qm work`);
    expect(await ws.changeStamp(a)).not.toBe(third);
  });

  it("never rewrites the index while reading, so an agent's commit never meets our lock", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/a-1", "main");
    await sh(local, `cd ${a} && sleep 1 && touch README.md src/a.ts`);
    const index = await sh(local, `git -C ${a} rev-parse --git-path index`);
    const before = await sh(local, `cd ${a} && stat -c %Y.%Z ${index} && sha1sum ${index}`);

    await ws.files(a, "merge-base:main");
    await ws.uncommitted(a);

    expect(await sh(local, `cd ${a} && stat -c %Y.%Z ${index} && sha1sum ${index}`)).toBe(before);
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

  async function githubRefuses(message: string) {
    writeFileSync(
      join(bare, "hooks", "pre-receive"),
      `#!/bin/sh\ncat >&2 <<'EOF'\n${message}\nEOF\nexit 1\n`,
      {
        mode: 0o755,
      },
    );
  }

  it("names the missing workflow scope instead of a moved branch", async () => {
    const a = await worktree("a", "ta/a-1");
    await sh(local, `cd ${a} && printf 'x\\n' > x.txt && git add -A && git commit --quiet -m x`);
    await githubRefuses(
      "refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope",
    );

    const error = (await ws.push(a, repo, "ta/a-1").catch((e: unknown) => e)) as WorkspaceError;
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error.code).toBe("denied");
    expect(error.message).toBe(
      "GitHub refused the push: it changes .github/workflows and the GitHub login lacks the workflow scope. Run `gh auth refresh -h github.com -s workflow`, then push again.",
    );
  });

  it("passes on GitHub's own reason for any other refusal", async () => {
    const a = await worktree("a", "ta/a-1");
    await sh(local, `cd ${a} && printf 'x\\n' > x.txt && git add -A && git commit --quiet -m x`);
    await githubRefuses("GH006: Protected branch update failed for refs/heads/ta/a-1.");

    const error = (await ws.push(a, repo, "ta/a-1").catch((e: unknown) => e)) as WorkspaceError;
    expect(error.code).toBe("denied");
    expect(error.message).toContain("GitHub refused the push");
    expect(error.message).toContain("GH006: Protected branch update failed");
    expect(error.message).not.toContain("moved there");
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

  it("knows a branch name is taken, here or on the remote", async () => {
    await ws.addWorktree(checkout, join(local.home, "a"), "ta/fix-login", "main");
    await sh(local, `git -C ${bare} branch ta/on-remote main`);
    await sh(local, `git -C ${checkout} fetch --quiet origin`);
    expect(await ws.branchTaken(checkout, "ta/fix-login")).toBe(true);
    expect(await ws.branchTaken(checkout, "ta/on-remote")).toBe(true);
    expect(await ws.branchTaken(checkout, "ta/fix-login-2")).toBe(false);
  });

  it("sees a branch pushed to GitHub since the checkout last fetched", async () => {
    await sh(local, `git -C ${bare} branch ta/github-actions-job-failing main`);
    expect(await ws.branchTaken(checkout, "ta/github-actions-job-failing")).toBe(true);
  });

  it("does nothing for a branch not on the remote yet", async () => {
    const a = join(local.home, "a");
    await ws.addWorktree(checkout, a, "ta/new-1", "main");
    await expect(ws.syncToRemote(a, repo, "ta/new-1")).resolves.toBeUndefined();
  });
});

describe("names and paths", () => {
  it("makes a short branch slug from a task, without the filler", () => {
    expect(branchSlug("Fix the login flow!")).toBe("fix-login-flow");
    expect(
      branchSlug("Can you please fix the login flow when users sign in with Google? It 500s."),
    ).toBe("fix-login-flow-users");
    expect(branchSlug("Let's add a dark mode toggle to the settings page")).toBe(
      "add-dark-mode-toggle",
    );
    expect(branchSlug("Refactor authentication middleware configuration loading")).toBe(
      "refactor-authentication",
    );
    expect(branchSlug("   ")).toBe("thread");
    expect(branchSlug("Please, could you?")).toBe("please-could-you");
  });

  it("cleans a model's branch name into a slug, or refuses it", () => {
    expect(cleanBranchSlug("fix-google-sign-in")).toBe("fix-google-sign-in");
    expect(cleanBranchSlug("Branch name: `feat/Dark_Mode Toggle`.")).toBe("feat-dark-mode-toggle");
    expect(cleanBranchSlug("<think>hmm</think>\n\nta/add-retry-to-uploads\nBecause…")).toBe(
      "add-retry-to-uploads",
    );
    expect(cleanBranchSlug("")).toBeNull();
    expect(cleanBranchSlug("??")).toBeNull();
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
    expect(await ws.uncommitted(a)).toEqual([" M README.md", "?? new.txt"]);
    const head = await ws.headSha(a);

    expect((await ws.files(a, start, one)).map((f) => [f.path, f.status])).toEqual([
      ["README.md", "modified"],
      ["new.txt", "added"],
    ]);
    expect(await ws.file(a, "README.md", start, one)).toEqual({
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
    expect(await sh(local, `git -C ${a} log -1 --format=%s`)).toBe("later");
    expect(await ws.headSha(a)).not.toBe(head);
  });
});
