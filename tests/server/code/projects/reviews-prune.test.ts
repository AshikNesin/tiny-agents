import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createNamespaceKv } from "@groot/core/kv";
import { api, createTestApp } from "../../helpers";
import { authToken, resetAppTables } from "../../fixtures";
import { FIXED_NOW } from "../../../test-clock";
import { installAppForTests } from "../../../../apps/web/src/server/app-root";
import { createWorkspace } from "../../../../apps/web/src/server/api/code/code.workspace";
import { pruneReviewCheckouts } from "../../../../apps/web/src/server/api/code/code.reviews.prune";
import type {
  ProjectView,
  PullReviewView,
  ReviewFile,
} from "../../../../apps/web/src/shared/api/code";
import { bareRepo, localExec, sh, type LocalExec } from "./local-exec";
import { fakeGitHub, type FakeGitHub } from "./fake-github";

const token = await authToken("code-reviews-prune@example.com");
const app = createTestApp();
const TWO_DAYS_LATER = new Date(Date.parse(FIXED_NOW) + 2 * 86_400_000);
const AN_HOUR_LATER = new Date(Date.parse(FIXED_NOW) + 3_600_000);

let local: LocalExec;
let bare: string;
let github: FakeGitHub;

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
});

afterEach(() => {
  installAppForTests({ codeGitHub: undefined });
  local.cleanup();
});

const call = <T = unknown>(method: string, path: string, json?: unknown) =>
  api<T>(app, `/api/v1/code${path}`, {
    method,
    token,
    ...(json !== undefined ? { json } : {}),
  });

async function newProject(): Promise<ProjectView> {
  const res = await call<ProjectView>("POST", "/projects", { repo: "acme/web" });
  expect(res.status).toBe(201);
  return res.body.data!;
}

async function pull(number: number, author: string): Promise<string> {
  const clone = join(local.home, `pr-${number}`);
  await sh(
    local,
    [
      `git clone --quiet ${bare} ${clone}`,
      `cd ${clone}`,
      `printf 'export const n = ${number};\\n' > src/n${number}.ts`,
      `git add -A && git -c user.name=x -c user.email=x@x commit --quiet -m change`,
      `git push --quiet origin HEAD:refs/pull/${number}/head`,
    ].join(" && "),
  );
  github.pulls.push({
    number,
    author,
    head: `${author}:change-${number}`,
    base: "main",
    title: `Change ${number}`,
    body: "",
    draft: false,
    state: "open",
    mergeable: "mergeable",
    checks: [],
    reviews: [],
    threads: [],
    fromFork: true,
    inMergeQueue: false,
    queueRemovals: [],
  });
  return sh(local, `git -C ${clone} rev-parse HEAD`);
}

const open = async (number: number) =>
  (await call<PullReviewView>("POST", "/reviews", { pr: `acme/web#${number}` })).body.data!;

const checkout = (number: number) =>
  join(local.home, `tiny-agents-code/acme--web/reviews/pr-${number}`);

const reviewFiles = (key: string) =>
  call<ReviewFile[]>("GET", `/threads/${encodeURIComponent(key)}/review/files`);

describe("pruning PR review checkouts", () => {
  it("removes an idle checkout of someone else's PR, keeps the review listed, and checks it out again on open", async () => {
    await newProject();
    const head = await pull(7, "maria");
    const review = await open(7);
    expect(existsSync(checkout(7))).toBe(true);

    expect(await pruneReviewCheckouts(TWO_DAYS_LATER)).toBe(1);

    expect(existsSync(checkout(7))).toBe(false);
    const list = (await call<PullReviewView[]>("GET", "/reviews")).body.data!;
    expect(list.map((r) => [r.id, r.archived])).toEqual([[review.id, false]]);
    const files = await reviewFiles(review.key);
    expect(files.status).toBe(200);
    expect(files.body.data!.map((f) => f.path)).toEqual(["src/n7.ts"]);
    expect(await sh(local, `git -C ${checkout(7)} rev-parse HEAD`)).toBe(head);
  });

  it("keeps the owner's own PRs, checkouts with work in them, and ones opened in the last day", async () => {
    await newProject();
    await pull(7, "ashik");
    await pull(8, "maria");
    await pull(9, "maria");
    await open(7);
    await open(8);
    await open(9);
    await sh(local, `printf 'wip\\n' > ${checkout(8)}/src/wip.ts`);
    await sh(
      local,
      `cd ${checkout(9)} && printf 'x\\n' > src/x.ts && git add -A && git -c user.name=x -c user.email=x@x commit --quiet -m local`,
    );
    await pull(10, "maria");
    await open(10);

    expect(await pruneReviewCheckouts(AN_HOUR_LATER)).toBe(0);
    expect(await pruneReviewCheckouts(TWO_DAYS_LATER)).toBe(1);

    expect([7, 8, 9, 10].map((n) => existsSync(checkout(n)))).toEqual([true, true, true, false]);
  });

  it("leaves an archived review archived", async () => {
    await newProject();
    await pull(7, "maria");
    const review = await open(7);
    await call("POST", `/reviews/${review.id}/archive`);

    expect(await pruneReviewCheckouts(TWO_DAYS_LATER)).toBe(0);

    const files = await reviewFiles(review.key);
    expect(files.status).toBe(404);
    expect(existsSync(checkout(7))).toBe(false);
  });
});
