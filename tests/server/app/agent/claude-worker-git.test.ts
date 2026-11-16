/**
 * The worker's git ops for the Code page's Changes panel, on real git in a
 * temporary repository: what the panel is sent for files it cannot show as
 * text, and that reading never rewrites the index an agent commits through.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vite-plus/test";
import { runCodingOp } from "../../../../packages/claude-worker/src/coding-ops";

const ctx = { limits: { maxUploadBytes: 1024, maxAssetBytes: 1024 } };
let repo: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: repo,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "ta-worker-git-"));
  git("init", "--quiet", "-b", "main");
  writeFileSync(path.join(repo, "README.md"), "hello\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "init");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

it("says a binary or oversized working file cannot be shown instead of sending it", async () => {
  writeFileSync(path.join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  writeFileSync(path.join(repo, "big.txt"), "a".repeat(3_000_000));

  const op = (file: string) =>
    runCodingOp({ op: "git_file", cwd: repo, diffId: "working", path: file }, ctx);
  expect(await op("logo.png")).toEqual({
    path: "logo.png",
    oldContent: "",
    newContent: "",
    unshowable: "binary",
  });
  expect(await op("big.txt")).toEqual({
    path: "big.txt",
    oldContent: "",
    newContent: "",
    unshowable: "tooLarge",
  });
  const files = (await runCodingOp(
    { op: "git_files", cwd: repo, diffId: "working" },
    ctx,
  )) as Array<{ path: string; binary?: boolean }>;
  expect(files.find((f) => f.path === "logo.png")?.binary).toBe(true);
});

it("lists changes without rewriting the index, so an agent's commit never meets our lock", async () => {
  // Same content, newer timestamp: a refreshing read would rewrite the index.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  writeFileSync(path.join(repo, "README.md"), "hello\n");
  const index = path.join(repo, ".git", "index");
  const before = statSync(index).mtimeMs;

  const files = await runCodingOp({ op: "git_files", cwd: repo, diffId: "working" }, ctx);
  await runCodingOp({ op: "git_log", cwd: repo }, ctx);

  expect(files).toEqual([]);
  expect(statSync(index).mtimeMs).toBe(before);
});
