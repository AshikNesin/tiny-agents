import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { api, createTestApp } from "../helpers";
import { authToken, resetAppTables } from "../fixtures";
import { codeThreads, db } from "../../../apps/web/src/server/db";
import { installAppForTests } from "../../../apps/web/src/server/app-root";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import {
  createWorkspace,
  type Workspace,
} from "../../../apps/web/src/server/api/code/code.workspace";
import { fakeHarness, type FakeHarness } from "./fake-harness";
import { bareRepo, localExec, sh, type LocalExec } from "./projects/local-exec";
import { fakeGitHub, type FakeGitHub } from "./projects/fake-github";
import type { ProjectView, CheckpointView } from "../../../apps/web/src/shared/api/code";

const token = await authToken("code-revert@example.com");
const app = createTestApp();

let local: LocalExec;
let bare: string;
let github: FakeGitHub;
let harness: FakeHarness;
let ws: Workspace;

beforeEach(async () => {
  await resetAppTables();
  local = localExec();
  bare = await bareRepo(local);
  github = fakeGitHub(local, bare);
  ws = createWorkspace({
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
      appRepositories: async () => [{ fullName: "acme/web", installationId: 4242, private: true }],
      convertManifest: async () => {
        throw new Error("unused");
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

async function newThread(projectId: string) {
  const res = await call<{ threadId: string }>("POST", "/threads", {
    projectId,
    message: "Fix the login flow",
  });
  expect(res.status).toBe(201);
  const row = (await db.query.codeThreads.findFirst({
    where: eq(codeThreads.id, res.body.data!.threadId),
  }))!;
  return { id: row.id, worktree: row.worktree!, branch: row.branch!, nativeId: row.nativeId };
}

const checkpointsOfThread = (id: string) =>
  call<CheckpointView[]>("GET", `/threads/${encodeURIComponent(id)}/checkpoints`);

describe("reverting to a checkpoint while an agent works", () => {
  it("refuses when the agent starts inside the check-to-restore window, keeping the files", async () => {
    const project = await newProject();
    const thread = await newThread(project.id);
    await sh(local, `cd ${thread.worktree} && printf 'uncommitted agent work\\n' > agent.txt`);
    const list = (await checkpointsOfThread(thread.id)).body.data!;
    const start = list[list.length - 1]!;
    expect(start.reason).toBe("start");

    const original = harness.outcome.bind(harness);
    let reads = 0;
    harness.outcome = async (nativeId) => {
      const outcome = await original(nativeId);
      reads += 1;
      return reads > 1 ? { ...outcome, working: true } : outcome;
    };

    const revert = await call(
      "POST",
      `/threads/${encodeURIComponent(thread.id)}/checkpoints/${start.id}/revert`,
    );
    expect(revert.status).toBe(409);
    expect(revert.body.error?.message).toBe("Stop the agent before reverting its files.");
    expect(existsSync(`${thread.worktree}/agent.txt`)).toBe(true);
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(await db.select().from(codeThreads).where(eq(codeThreads.id, thread.id))).toHaveLength(
      1,
    );
  });

  it("still reverts once the agent has stopped", async () => {
    const project = await newProject();
    const thread = await newThread(project.id);
    await sh(local, `cd ${thread.worktree} && printf 'uncommitted agent work\\n' > agent.txt`);
    const list = (await checkpointsOfThread(thread.id)).body.data!;
    const start = list[list.length - 1]!;
    const revert = await call(
      "POST",
      `/threads/${encodeURIComponent(thread.id)}/checkpoints/${start.id}/revert`,
    );
    expect(revert.status).toBe(200);
    expect(existsSync(`${thread.worktree}/agent.txt`)).toBe(false);
  });
});
