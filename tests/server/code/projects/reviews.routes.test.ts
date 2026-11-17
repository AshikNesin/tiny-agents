/**
 * PR reviews (issue #345) through the real routes and the real git
 * workspace: a local bare repository stands in for GitHub's (a PR's head is
 * only under `refs/pull/N/head`, as a fork's is), with an in-memory GitHub
 * API and the in-memory harness.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createNamespaceKv } from "@groot/core/kv";
import { api, createTestApp } from "../../helpers";
import { authToken, resetAppTables } from "../../fixtures";
import { installAppForTests } from "../../../../apps/web/src/server/app-root";
import { createCodeHub, setCodeHub } from "../../../../apps/web/src/server/api/code/code.hub";
import { createWorkspace } from "../../../../apps/web/src/server/api/code/code.workspace";
import type {
  ProjectView,
  PullReviewView,
  ReviewDraft,
  ReviewFile,
  ReviewFileDiff,
} from "../../../../apps/web/src/shared/api/code";
import type { ThreadSummary } from "../../../../packages/code/src/contracts/index";
import { fakeHarness, type FakeHarness } from "../fake-harness";
import { bareRepo, localExec, sh, type LocalExec } from "./local-exec";
import { fakeGitHub, type FakeGitHub } from "./fake-github";

const token = await authToken("code-reviews@example.com");
const app = createTestApp();

let local: LocalExec;
let bare: string;
let github: FakeGitHub;
let harness: FakeHarness;

beforeEach(async () => {
  await resetAppTables();
  await createNamespaceKv("CODE_GITHUB").clear();
  local = localExec();
  bare = await bareRepo(local);
  github = fakeGitHub(local, bare);
  const ws = createWorkspace({
    exec: local.exec,
    credential: { kind: "token", token: async () => "ghs_test" },
    remoteUrl: () => bare,
  });
  installAppForTests({
    codeGitHub: {
      client: async () => github,
      workspace: async () => ws,
      credential: async () => "token",
      installationFor: async () => 4242,
      appRepositories: async () => [],
      convertManifest: async () => {
        throw new Error("not in these tests");
      },
    },
  });
  harness = fakeHarness("fake", {
    workspace: {
      diffs: false,
      findFiles: false,
      uploads: false,
      skills: false,
      browse: false,
      worktrees: false,
      requiresCwd: true,
    },
  });
  setCodeHub(createCodeHub({ instances: [harness], listDebounceMs: 5 }))!.start();
});

afterEach(() => {
  setCodeHub(undefined);
  installAppForTests({ codeGitHub: undefined, codeBranchNamer: undefined });
  local.cleanup();
});

const call = <T = unknown>(method: string, path: string, json?: unknown) =>
  api<T>(app, `/api/v1/code${path}`, {
    method,
    token,
    ...(json !== undefined ? { json } : {}),
  });

async function newProject(): Promise<ProjectView> {
  const res = await call<ProjectView>("POST", "/projects", {
    repo: "acme/web",
    defaultInstanceId: "fake",
  });
  expect(res.status).toBe(201);
  return res.body.data!;
}

/**
 * Someone's PR #7 from a fork: its commits live only under
 * `refs/pull/7/head` in the "GitHub" repository, never as a branch there.
 * Answers the head sha.
 */
async function forkPull(lines: string[]): Promise<string> {
  const fork = join(local.home, "fork");
  if (!existsSync(fork)) {
    await sh(local, `git clone --quiet ${bare} ${fork}`);
    github.pulls.push({
      number: 7,
      head: "maria:retry-webhooks",
      base: "main",
      title: "Retry webhooks with backoff",
      body: "Retries failed webhooks.\n<!-- template: describe your change -->",
      draft: false,
      state: "open",
      mergeable: "mergeable",
      checks: [],
      reviews: [],
      threads: [],
      fromFork: true,
      autoMerge: false,
      inMergeQueue: false,
      queueRemovals: [],
    });
  }
  await sh(
    local,
    [
      `cd ${fork}`,
      ...lines,
      `git add -A && git commit --quiet -m change`,
      `git push --quiet --force origin HEAD:refs/pull/7/head`,
    ].join(" && "),
  );
  return sh(local, `git -C ${fork} rev-parse HEAD`);
}

const reviewFiles = async (key: string) =>
  (await call<ReviewFile[]>("GET", `/threads/${encodeURIComponent(key)}/review/files`)).body.data!;

describe("PR reviews", () => {
  it("opens someone's PR from a fork at its head, diffed against its base, with no model call", async () => {
    await newProject();
    const head = await forkPull([
      `printf 'export const a = 2;\\n' > src/a.ts`,
      `printf 'export const retry = 3;\\n' > src/retry.ts`,
    ]);

    const res = await call<PullReviewView>("POST", "/reviews", {
      pr: "https://github.com/acme/web/pull/7/files",
    });

    expect(res.status).toBe(201);
    const review = res.body.data!;
    expect(review).toMatchObject({
      repo: "acme/web",
      number: 7,
      title: "Retry webhooks with backoff",
      headRef: "maria:retry-webhooks",
      baseRef: "main",
      headSha: head,
      fromFork: true,
      threadId: null,
    });
    const files = await reviewFiles(review.key);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["src/a.ts", "modified", 1, 1],
      ["src/retry.ts", "added", 1, 0],
    ]);
    const diff = (
      await call<ReviewFileDiff>(
        "GET",
        `/threads/${encodeURIComponent(review.key)}/review/file?path=src/a.ts`,
      )
    ).body.data!;
    expect(diff).toMatchObject({
      oldContent: "export const a = 1;\n",
      newContent: "export const a = 2;\n",
    });
    // Nothing was asked yet: no assistant, so no model call.
    expect(harness.created).toEqual([]);
    const list = (await call<PullReviewView[]>("GET", "/reviews")).body.data!;
    expect(list.map((r) => r.id)).toEqual([review.id]);
  });

  it("opening the PR again moves the same review to the PR's new head", async () => {
    await newProject();
    await forkPull([`printf 'one\\n' > src/one.ts`]);
    const first = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body.data!;
    const second = await forkPull([`printf 'two\\n' > src/two.ts`]);

    const again = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body.data!;

    expect(again.id).toBe(first.id);
    expect(again.headSha).toBe(second);
    expect((await reviewFiles(again.key)).map((f) => f.path)).toEqual(["src/one.ts", "src/two.ts"]);
  });

  it("refuses a PR whose repository is not a project, saying how to add it", async () => {
    const res = await call("POST", "/reviews", { pr: "https://github.com/other/repo/pull/3" });

    expect(res.status).toBe(404);
    expect(res.body.error?.message).toBe(
      "other/repo is not a project yet. Add it in Code settings → Projects first.",
    );
  });

  it("starts the assistant on the first question with a short PR card, never the diff", async () => {
    await newProject();
    await forkPull([
      `printf 'export const a = 2;\\n' > src/a.ts`,
      `printf '{}\\n' > pnpm-lock.yaml`,
    ]);
    const review = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body
      .data!;
    // A line comment written before the assistant exists goes with the first question.
    const draft = await call<ReviewDraft>(
      "POST",
      `/threads/${encodeURIComponent(review.key)}/review/drafts`,
      { path: "src/a.ts", startLine: 1, endLine: 1, quote: "export const a = 2;", body: "Why 2?" },
    );
    expect(draft.status).toBe(201);

    const asked = await call<{ threadId: string }>("POST", `/reviews/${review.id}/ask`, {
      message: "Is this safe to merge?",
    });

    expect(asked.status).toBe(200);
    expect(asked.body.data!.threadId).toBe("fake:t1");
    expect(harness.created).toHaveLength(1);
    const start = harness.created[0]!;
    const worktree = join(local.home, "tiny-agents-code/acme--web/reviews/pr-7");
    expect(start.cwd).toBe(worktree);
    const message = start.message as string;
    expect(message).toContain("[Review acme/web#7 · head ");
    expect(message).toContain("Title: Retry webhooks with backoff");
    expect(message).toContain("Description: Retries failed webhooks.\n");
    expect(message).not.toContain("template: describe your change");
    expect(message).toContain("Changed files (2, +2 −1):\nM src/a.ts +1 −1\n");
    expect(message).toContain("Generated files and lockfiles: 1 (not listed)");
    expect(message).not.toContain("pnpm-lock.yaml");
    // The comment, then the question.
    expect(message).toMatch(
      /Review comments \(1\):\n\n\*\*`src\/a\.ts:1`\*\*\n```\nexport const a = 2;\n```\nWhy 2\?\n\n---\n\nIs this safe to merge\?$/,
    );
    expect(harness.renamed).toEqual([
      { nativeId: "t1", title: "Review #7: Retry webhooks with backoff" },
    ]);
    const after = (await call<PullReviewView>("GET", `/reviews/${review.id}`)).body.data!;
    expect(after.threadId).toBe("fake:t1");
    const waiting = (
      await call<ReviewDraft[]>("GET", `/threads/${encodeURIComponent(review.key)}/review/drafts`)
    ).body.data!;
    expect(waiting).toEqual([]);

    // A later question goes to the same assistant, without the card.
    await call("POST", `/reviews/${review.id}/ask`, { message: "And the tests?" });
    expect(harness.created).toHaveLength(1);
    expect(harness.sent).toEqual([{ nativeId: "t1", message: "And the tests?" }]);
  });

  it("marks the assistant's thread in the list as the review's", async () => {
    await newProject();
    await forkPull([`printf 'x\\n' > src/x.ts`]);
    const review = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body
      .data!;
    await call("POST", `/reviews/${review.id}/ask`, { message: "Summarize it" });

    const threads = (await call<ThreadSummary[]>("GET", "/threads")).body.data!;

    expect(threads.find((t) => t.id === "fake:t1")?.review).toEqual({ id: review.id, number: 7 });
  });

  it("archiving a review removes its worktree and takes it off the list", async () => {
    await newProject();
    await forkPull([`printf 'x\\n' > src/x.ts`]);
    const review = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body
      .data!;
    const worktree = join(local.home, "tiny-agents-code/acme--web/reviews/pr-7");
    expect(existsSync(worktree)).toBe(true);

    const res = await call("POST", `/reviews/${review.id}/archive`);

    expect(res.status).toBe(200);
    expect(existsSync(worktree)).toBe(false);
    expect((await call<PullReviewView[]>("GET", "/reviews")).body.data).toEqual([]);
    const files = await call("GET", `/threads/${encodeURIComponent(review.key)}/review/files`);
    expect(files.status).toBe(404);
  });
});
