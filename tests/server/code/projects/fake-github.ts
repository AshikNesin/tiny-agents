/**
 * An in-memory GitHub for Code's app-layer tests (the network is the
 * boundary): pull requests the tests open, check and review, plus every
 * write the app makes (replies, resolves, comments, merges), recorded. A
 * PR's head sha is read from the real bare repository the workspace pushes
 * to, so a push the app makes is what the next snapshot sees.
 */
import type {
  Check,
  GitHubClient,
  PullSnapshot,
  Review,
  ReviewThread,
} from "../../../../packages/github/src/index";
import type { LocalExec } from "./local-exec";
import { sh } from "./local-exec";

interface FakePull {
  number: number;
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
  merged: Array<{ number: number; method: string }>;
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
    merged: [],
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
        headSha: await headOf(pr.head),
        baseRef: pr.base,
        fromFork: pr.fromFork,
        mergeable: pr.mergeable,
        mergeMethods: ["squash", "merge"],
        author: login,
        autoMerge: pr.autoMerge,
        inMergeQueue: pr.inMergeQueue,
        queueRemovals: pr.queueRemovals,
        checks: pr.checks,
        reviews: pr.reviews,
        threads: pr.threads,
        comments: [],
      };
    },
    async jobLogTail() {
      return "FAIL src/a.test.ts\nExpected 1, received 2";
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
    async merge(_repo, number, method) {
      gh.merged.push({ number, method });
      gh.pull(number).state = "merged";
    },
  };
  return gh;
}
