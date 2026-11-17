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
import { codePullRequests, db } from "../../../../apps/web/src/server/db";
import { installAppForTests } from "../../../../apps/web/src/server/app-root";
import { createCodeHub, setCodeHub } from "../../../../apps/web/src/server/api/code/code.hub";
import { createWorkspace } from "../../../../apps/web/src/server/api/code/code.workspace";
import type {
  InboxPullView,
  ProjectView,
  PullReviewView,
  PullThreadsView,
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
async function forkPull(lines: string[], author = "maria"): Promise<string> {
  const fork = join(local.home, "fork");
  if (!existsSync(fork)) {
    await sh(local, `git clone --quiet ${bare} ${fork}`);
    github.pulls.push({
      number: 7,
      author,
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

describe("submitting a PR review", () => {
  const open = async () =>
    (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body.data!;
  const comments = (id: string) => `/reviews/${id}/comments`;

  it("posts the pending comments with the verdict at the head the owner read, apart from the assistant's", async () => {
    await newProject();
    const head = await forkPull([
      `printf 'export const a = 2;\\nexport const b = 3;\\n' > src/a.ts`,
    ]);
    const review = await open();
    expect(review.mine).toBe(false);
    await call("POST", comments(review.id), {
      path: "src/a.ts",
      startLine: 2,
      endLine: 2,
      body: "Name this",
    });
    await call("POST", comments(review.id), {
      path: "src/a.ts",
      side: "old",
      startLine: 1,
      endLine: 1,
      body: "Why drop 1?",
    });
    // A comment for the assistant stays out of the review.
    await call("POST", `/threads/${encodeURIComponent(review.key)}/review/drafts`, {
      path: "src/a.ts",
      startLine: 1,
      endLine: 2,
      body: "Explain this",
    });

    const res = await call<{ url: string; comments: number }>(
      "POST",
      `/reviews/${review.id}/submit`,
      { event: "REQUEST_CHANGES", body: "Two small things" },
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      url: "https://github.com/acme/web/pull/7#pullrequestreview-1",
      comments: 2,
    });
    expect(github.submitted).toEqual([
      {
        number: 7,
        commitId: head,
        event: "REQUEST_CHANGES",
        body: "Two small things",
        comments: [
          { path: "src/a.ts", side: "RIGHT", line: 2, body: "Name this" },
          { path: "src/a.ts", side: "LEFT", line: 1, body: "Why drop 1?" },
        ],
      },
    ]);
    expect((await call<ReviewDraft[]>("GET", comments(review.id))).body.data).toEqual([]);
    const forAgent = (
      await call<ReviewDraft[]>("GET", `/threads/${encodeURIComponent(review.key)}/review/drafts`)
    ).body.data!;
    expect(forAgent.map((d) => d.body)).toEqual(["Explain this"]);
  });

  it("sends a range as its first and last line", async () => {
    await newProject();
    await forkPull([`printf 'a\\nb\\nc\\n' > src/r.ts`]);
    const review = await open();
    await call("POST", comments(review.id), {
      path: "src/r.ts",
      startLine: 1,
      endLine: 3,
      body: "Simplify",
    });

    await call("POST", `/reviews/${review.id}/submit`, { event: "COMMENT" });

    expect(github.submitted[0]?.comments).toEqual([
      { path: "src/r.ts", side: "RIGHT", startLine: 1, line: 3, body: "Simplify" },
    ]);
  });

  it("on the owner's own PR allows only a comment, as GitHub does", async () => {
    await newProject();
    await forkPull([`printf 'x\\n' > src/x.ts`], "ashik");
    const review = await open();
    expect(review.mine).toBe(true);
    await call("POST", comments(review.id), {
      path: "src/x.ts",
      startLine: 1,
      endLine: 1,
      body: "Note to self",
    });

    const approve = await call("POST", `/reviews/${review.id}/submit`, { event: "APPROVE" });

    expect(approve.status).toBe(400);
    expect(approve.body.error?.message).toBe(
      "GitHub does not let you approve or request changes on your own pull request. Submit it as a comment.",
    );
    expect(github.submitted).toEqual([]);
    // The comment still waits, and goes as a comment.
    const comment = await call("POST", `/reviews/${review.id}/submit`, { event: "COMMENT" });
    expect(comment.status).toBe(200);
    expect(github.submitted.map((r) => [r.event, r.comments.length])).toEqual([["COMMENT", 1]]);
  });

  it("refuses an empty comment review and a change request without a summary", async () => {
    await newProject();
    await forkPull([`printf 'x\\n' > src/x.ts`]);
    const review = await open();

    const empty = await call("POST", `/reviews/${review.id}/submit`, { event: "COMMENT" });
    const bare = await call("POST", `/reviews/${review.id}/submit`, {
      event: "REQUEST_CHANGES",
      body: "  ",
    });

    expect([empty.status, empty.body.error?.message]).toEqual([
      400,
      "Add a comment or a summary first.",
    ]);
    expect([bare.status, bare.body.error?.message]).toEqual([
      400,
      "Say what to change: GitHub needs a summary to request changes.",
    ]);
    expect(github.submitted).toEqual([]);
  });

  it("sends the comments to the Code thread that opened the PR instead", async () => {
    const project = await newProject();
    await forkPull([`printf 'x\\n' > src/x.ts`], "ashik");
    await db.insert(codePullRequests).values({
      threadId: "fake:t9",
      projectId: project.id,
      number: 7,
      url: "https://github.com/acme/web/pull/7",
      headRef: "ta/x",
      baseRef: "main",
    });
    const review = await open();
    expect(review.codingThreadId).toBe("fake:t9");
    await call("POST", comments(review.id), {
      path: "src/x.ts",
      startLine: 1,
      endLine: 1,
      quote: "x",
      body: "Rename x",
    });

    const res = await call("POST", `/reviews/${review.id}/comments/to-thread`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ threadId: "fake:t9", sent: 1 });
    expect(harness.sent).toEqual([
      {
        nativeId: "t9",
        message: "Review comments (1):\n\n**`src/x.ts:1`**\n```\nx\n```\nRename x",
      },
    ]);
    expect(github.submitted).toEqual([]);
    expect((await call<ReviewDraft[]>("GET", comments(review.id))).body.data).toEqual([]);
  });
});

describe("the PR's conversations on GitHub", () => {
  it("lists them with their side and lines, and replies and resolves as the owner", async () => {
    await newProject();
    const head = await forkPull([`printf 'x\\n' > src/x.ts`]);
    const review = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body
      .data!;
    github.pull(7).threads.push(
      {
        id: "T_1",
        path: "src/x.ts",
        line: 1,
        startLine: null,
        side: "RIGHT",
        resolved: false,
        outdated: false,
        comments: [
          {
            id: "C_1",
            databaseId: 11,
            author: { login: "carol", type: "user", association: "MEMBER" },
            body: "Why x?",
            createdAt: "2026-11-16T10:00:00Z",
          },
        ],
      },
      {
        id: "T_2",
        path: "src/a.ts",
        line: null,
        side: "LEFT",
        resolved: true,
        outdated: true,
        comments: [],
      },
    );

    const res = await call<PullThreadsView>("GET", `/reviews/${review.id}/threads`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      headSha: head,
      threads: [
        {
          id: "T_1",
          path: "src/x.ts",
          side: "new",
          line: 1,
          startLine: null,
          resolved: false,
          outdated: false,
          comments: [
            {
              id: "C_1",
              author: "carol",
              bot: false,
              body: "Why x?",
              createdAt: "2026-11-16T10:00:00Z",
            },
          ],
        },
        {
          id: "T_2",
          path: "src/a.ts",
          side: "old",
          line: null,
          startLine: null,
          resolved: true,
          outdated: true,
          comments: [],
        },
      ],
    });

    const reply = await call("POST", `/reviews/${review.id}/threads/T_1/reply`, {
      body: "Renamed, thanks",
    });
    const resolve = await call("POST", `/reviews/${review.id}/threads/T_1/resolve`);

    expect([reply.status, resolve.status]).toEqual([200, 200]);
    expect(github.replies).toEqual([{ threadId: "T_1", body: "Renamed, thanks" }]);
    expect(github.resolved).toEqual(["T_1"]);
  });

  it("refuses an empty reply", async () => {
    await newProject();
    await forkPull([`printf 'x\\n' > src/x.ts`]);
    const review = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body
      .data!;

    const res = await call("POST", `/reviews/${review.id}/threads/T_1/reply`, { body: " " });

    expect(res.status).toBe(400);
    expect(github.replies).toEqual([]);
  });
});

describe("the review inbox", () => {
  const pull = (number: number, over: Partial<FakeGitHub["inbox"][number]> = {}) => ({
    reason: "requested" as const,
    repo: { owner: "acme", name: "web" },
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/web/pull/${number}`,
    author: "maria",
    draft: false,
    updatedAt: "2026-11-17T09:00:00Z",
    headSha: `head${number}`,
    decision: null,
    lastReview: null,
    ...over,
  });

  it("sorts GitHub's PRs into needs review, updated since your review, waiting and yours", async () => {
    const project = await newProject();
    await forkPull([`printf 'x\\n' > src/x.ts`]);
    const review = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body
      .data!;
    github.inbox = [
      pull(7),
      pull(8, {
        reason: "reviewed",
        lastReview: { at: "2026-11-16T08:00:00Z", commit: "older" },
      }),
      pull(9, { reason: "reviewed", lastReview: { at: "2026-11-16T08:00:00Z", commit: "head9" } }),
      pull(4, { reason: "authored", repo: { owner: "other", name: "lib" }, author: "ashik" }),
    ];

    const res = await call<InboxPullView[]>("GET", "/reviews/inbox");

    expect(res.status).toBe(200);
    expect(
      res.body.data!.map((p) => [p.section, p.repo, p.number, p.projectId, p.reviewId]),
    ).toEqual([
      ["needs", "acme/web", 7, project.id, review.id],
      ["updated", "acme/web", 8, project.id, null],
      ["waiting", "acme/web", 9, project.id, null],
      ["mine", "other/lib", 4, null, null],
    ]);
    expect(res.body.data![1]?.lastReviewAt).toBe("2026-11-16T08:00:00Z");
  });

  it("says when GitHub cannot be read", async () => {
    github.reviewInbox = async () => {
      throw new Error("Bad credentials");
    };

    const res = await call("GET", "/reviews/inbox");

    expect(res.status).toBe(400);
    expect(res.body.error?.message).toBe(
      "Cannot read your review requests on GitHub: Bad credentials",
    );
  });
});

describe("changes since your review", () => {
  it("diffs the PR from the commit of your last review on GitHub", async () => {
    await newProject();
    const reviewed = await forkPull([`printf 'one\\n' > src/one.ts`]);
    github.pull(7).reviews.push({
      id: "R_1",
      author: { login: "ashik", type: "user", association: "MEMBER" },
      state: "CHANGES_REQUESTED",
      body: "Split it",
      submittedAt: "2026-11-16T08:00:00Z",
      commit: reviewed,
    });
    await forkPull([`printf 'ONE\\n' > src/one.ts`, `printf 'two\\n' > src/two.ts`]);

    const review = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body
      .data!;
    expect(review.reviewedSha).toBe(reviewed);
    const key = encodeURIComponent(review.key);
    const files = (await call<ReviewFile[]>("GET", `/threads/${key}/review/files?since=review`))
      .body.data!;
    const diff = (
      await call<ReviewFileDiff>("GET", `/threads/${key}/review/file?path=src/one.ts&since=review`)
    ).body.data!;

    expect(files.map((f) => [f.path, f.status])).toEqual([
      ["src/one.ts", "modified"],
      ["src/two.ts", "added"],
    ]);
    expect(diff).toMatchObject({ oldContent: "one\n", newContent: "ONE\n" });
    // Against the base, src/one.ts is new.
    const all = (await call<ReviewFile[]>("GET", `/threads/${key}/review/files`)).body.data!;
    expect(all.find((f) => f.path === "src/one.ts")?.status).toBe("added");
  });

  it("submitting a review makes its commit the one to diff from next", async () => {
    await newProject();
    const head = await forkPull([`printf 'x\\n' > src/x.ts`]);
    const review = (await call<PullReviewView>("POST", "/reviews", { pr: "acme/web#7" })).body
      .data!;
    expect(review.reviewedSha).toBeNull();
    const before = await call(
      "GET",
      `/threads/${encodeURIComponent(review.key)}/review/files?since=review`,
    );
    expect([before.status, before.body.error?.message]).toEqual([
      400,
      "You have not reviewed this pull request yet.",
    ]);

    await call("POST", `/reviews/${review.id}/submit`, { event: "APPROVE" });

    expect(
      (await call<PullReviewView>("GET", `/reviews/${review.id}`)).body.data!.reviewedSha,
    ).toBe(head);
  });
});
