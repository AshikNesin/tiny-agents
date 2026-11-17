/**
 * An in-memory GitHub for Code's app-layer tests (the network is the
 * boundary): pull requests the tests open, check and review, plus every
 * write the app makes (replies, resolves, comments, merges), recorded. A
 * PR's head sha is read from the real bare repository the workspace pushes
 * to, so a push the app makes is what the next snapshot sees.
 */
import {
  GitHubError,
  type Check,
  type GitHubClient,
  type JobStep,
  type PullSnapshot,
  type Review,
  type ReviewThread,
} from "../../../../packages/github/src/index";
import type { LocalExec } from "./local-exec";
import { sh } from "./local-exec";

interface FakePull {
  number: number;
  /** Who opened it (the credential's login when unset). */
  author?: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: PullSnapshot["state"];
  mergeable: PullSnapshot["mergeable"];
  checks: Check[];
  reviews: Review[];
  threads: ReviewThread[];
  fromFork: boolean;
  autoMerge: boolean;
  inMergeQueue: boolean;
  queueRemovals: Array<{ id: string; at: string; reason: string }>;
}

export interface FakeGitHub extends GitHubClient {
  pulls: FakePull[];
  replies: Array<{ threadId: string; body: string }>;
  resolved: string[];
  comments: Array<{ number: number; body: string }>;
  /** Reviews submitted with `submitReview`, as sent. */
  submitted: Array<{ number: number } & Parameters<GitHubClient["submitReview"]>[2]>;
  merged: Array<{ number: number; method: string }>;
  /** Each Actions job's raw log, by job id (a default when unset). */
  logs: Map<number, string>;
  /** Jobs still running, by id; GitHub serves no log for these (404). */
  running: Map<number, JobStep[]>;
  /** Native auto-merge calls, by PR node id. */
  autoMergeCalls: Array<{
    pullId: string;
    action: "enable" | "disable" | "ready";
    method?: string;
  }>;
  pull(number: number): FakePull;
}

export function fakeGitHub(local: LocalExec, bare: string, login = "ashik"): FakeGitHub {
  let nextComment = 1000;
  const headOf = async (branch: string) =>
    sh(local, `git -C ${bare} rev-parse refs/heads/${branch} 2>/dev/null || echo missing`);
  const gh: FakeGitHub = {
    transport: "https",
    pulls: [],
    replies: [],
    resolved: [],
    comments: [],
    submitted: [],
    merged: [],
    logs: new Map(),
    running: new Map(),
    autoMergeCalls: [],
    pull(number) {
      const found = gh.pulls.find((p) => p.number === number);
      if (!found) throw new Error(`no PR ${number}`);
      return found;
    },
    async viewer() {
      return { login };
    },
    async repository() {
      return { defaultBranch: "main", private: true };
    },
    async openPullForBranch(_repo, branch) {
      const found = gh.pulls.find((p) => p.head === branch && p.state === "open");
      return found
        ? { number: found.number, url: `https://github.com/acme/web/pull/${found.number}` }
        : undefined;
    },
    async createPull(_repo, input) {
      const number = gh.pulls.length + 1;
      gh.pulls.push({
        number,
        ...input,
        state: "open",
        mergeable: "mergeable",
        checks: [],
        reviews: [],
        threads: [],
        fromFork: false,
        autoMerge: false,
        inMergeQueue: false,
        queueRemovals: [],
      });
      return { number, url: `https://github.com/acme/web/pull/${number}` };
    },
    async snapshot(_repo, number) {
      const pr = gh.pull(number);
      return {
        id: `PR_${number}`,
        number,
        url: `https://github.com/acme/web/pull/${number}`,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        draft: pr.draft,
        headRef: pr.head,
        // A fork's head lives only under refs/pull/N/head, as on GitHub.
        headSha: pr.fromFork
          ? await sh(local, `git -C ${bare} rev-parse refs/pull/${number}/head`)
          : await headOf(pr.head),
        baseRef: pr.base,
        fromFork: pr.fromFork,
        mergeable: pr.mergeable,
        mergeMethods: ["squash", "merge"],
        author: pr.author ?? login,
        autoMerge: pr.autoMerge,
        inMergeQueue: pr.inMergeQueue,
        queueRemovals: pr.queueRemovals,
        checks: pr.checks,
        reviews: pr.reviews,
        threads: pr.threads,
        comments: [],
      };
    },
    async job(_repo, jobId) {
      const steps = gh.running.get(jobId);
      return { completed: !steps, steps: steps ?? [] };
    },
    async jobLogTail(_repo, jobId, maxChars) {
      if (gh.running.has(jobId)) throw new GitHubError("Not Found", 404);
      return (gh.logs.get(jobId) ?? "FAIL src/a.test.ts\nExpected 1, received 2").slice(-maxChars);
    },
    async replyToThread(threadId, body) {
      gh.replies.push({ threadId, body });
      return { databaseId: (nextComment += 1) };
    },
    async resolveThread(threadId) {
      gh.resolved.push(threadId);
    },
    async comment(_repo, number, body) {
      gh.comments.push({ number, body });
      return { databaseId: (nextComment += 1) };
    },
    async submitReview(_repo, number, review) {
      gh.submitted.push({ number, ...review });
      return {
        url: `https://github.com/acme/web/pull/${number}#pullrequestreview-${gh.submitted.length}`,
      };
    },
    async enableAutoMerge(pullId, method) {
      gh.autoMergeCalls.push({ pullId, action: "enable", method });
      gh.pull(Number(pullId.replace("PR_", ""))).autoMerge = true;
    },
    async disableAutoMerge(pullId) {
      gh.autoMergeCalls.push({ pullId, action: "disable" });
      gh.pull(Number(pullId.replace("PR_", ""))).autoMerge = false;
    },
    async markReady(pullId) {
      gh.autoMergeCalls.push({ pullId, action: "ready" });
      gh.pull(Number(pullId.replace("PR_", ""))).draft = false;
    },
    async updatePull(_repo, number, change) {
      const pr = gh.pull(number);
      if (change.title !== undefined) pr.title = change.title;
      if (change.body !== undefined) pr.body = change.body;
    },
    async merge(_repo, number, method) {
      gh.merged.push({ number, method });
      gh.pull(number).state = "merged";
    },
  };
  return gh;
}
