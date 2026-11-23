import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db, codeProjects, codePullRequests, jobs } from "../../../apps/web/src/server/db";
import { resetAppTables } from "../fixtures";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import { armReconcile, RECONCILE_JOB } from "../../../apps/web/src/server/api/code/code.pulls";
import {
  cacheSnapshot,
  insertPull,
  openPullOf,
  type LinkInput,
} from "../../../apps/web/src/server/api/code/code.pulls.store";
import { fakeHarness } from "./fake-harness";
import type { PullSnapshot } from "@tiny-agents/github";

let project: { id: string };

beforeEach(async () => {
  await resetAppTables();
  setCodeHub(createCodeHub({ instances: [fakeHarness()], listDebounceMs: 5 }));
  const [row] = await db
    .insert(codeProjects)
    .values({
      name: "web",
      repoOwner: "acme",
      repoName: "web",
      baseBranch: "main",
      checkoutPath: "/tmp/acme--web/checkout",
    })
    .returning();
  project = { id: row!.id };
});

afterEach(() => {
  setCodeHub(undefined);
});

const linkInput = (number: number): LinkInput => ({
  threadId: "thread-1",
  projectId: project.id,
  number,
  url: `https://github.com/acme/web/pull/${number}`,
  title: "Fix the login flow",
  headRef: "ta/one",
  baseRef: "main",
  autofix: false,
});

const snapshot = (state: PullSnapshot["state"]): PullSnapshot => ({
  id: "PR_1",
  number: 5,
  url: "https://github.com/acme/web/pull/5",
  title: "Fix the login flow",
  body: "",
  state,
  draft: false,
  headRef: "ta/one",
  headSha: "a".repeat(40),
  baseRef: "main",
  fromFork: false,
  headRepo: null,
  maintainerCanModify: false,
  mergeable: "mergeable",
  mergeMethods: ["merge"],
  inMergeQueue: false,
  queueRemovals: [],
  author: "ashik",
  checks: [],
  reviews: [],
  threads: [],
  comments: [],
});

describe("insertPull under concurrency", () => {
  it("collapses two concurrent inserts of the same pull into one row", async () => {
    const [a, b] = await Promise.all([insertPull(linkInput(5)), insertPull(linkInput(5))]);
    expect(a.id).toBe(b.id);
    const rows = await db.select().from(codePullRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ number: 5, state: "open" });
  });

  it("collapses a second open pull for a thread onto the first", async () => {
    const [a, b] = await Promise.all([insertPull(linkInput(5)), insertPull(linkInput(6))]);
    expect(a.id).toBe(b.id);
    expect(await openPullOf("thread-1")).toMatchObject({ id: a.id });
    expect(await db.select().from(codePullRequests)).toHaveLength(1);
  });
});

describe("cacheSnapshot on a vanishing row", () => {
  it("reports the pull as gone instead of handing callers undefined state", async () => {
    const row = await insertPull(linkInput(5));
    const [gone] = await db
      .delete(codePullRequests)
      .where(eq(codePullRequests.id, row.id))
      .returning();
    expect(gone).toBeDefined();
    const after = await cacheSnapshot(row.id, snapshot("closed"));
    expect(after).toBeUndefined();
  });
});

describe("armReconcile under concurrency", () => {
  it("leaves exactly one live job when two arms race", async () => {
    const pull = await insertPull(linkInput(5));
    await Promise.all([armReconcile(pull.id, 60_000), armReconcile(pull.id, 60_000)]);

    const created = async () =>
      (await db.select().from(jobs)).filter(
        (j) => j.name === RECONCILE_JOB && j.state === "created",
      );
    const live = await created();
    expect(live).toHaveLength(1);
    const [row] = await db.select().from(codePullRequests).where(eq(codePullRequests.id, pull.id));
    expect(row!.pendingJobId).toBe(live[0]!.id);

    const again = await armReconcile(pull.id, 60_000);
    expect(again).toBeDefined();
    expect((await created()).map((j) => j.id)).toEqual([again]);
  });
});
