import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { api, createTestApp } from "../../helpers";
import { authToken, resetAppTables } from "../../fixtures";
import { codeProjects, codeReviews, codeThreads, db } from "../../../../apps/web/src/server/db";
import { installAppForTests } from "../../../../apps/web/src/server/app-root";
import { createCodeHub, setCodeHub } from "../../../../apps/web/src/server/api/code/code.hub";
import { createWorkspace } from "../../../../apps/web/src/server/api/code/code.workspace";
import { fakeHarness, type FakeHarness } from "../fake-harness";
import { bareRepo, localExec, sh, type LocalExec } from "./local-exec";
import { fakeGitHub, type FakeGitHub } from "./fake-github";
import type { ProjectView } from "../../../../apps/web/src/shared/api/code";

const token = await authToken("code-delete@example.com");
const app = createTestApp();

let local: LocalExec;
let bare: string;
let github: FakeGitHub;
let harness: FakeHarness;

beforeEach(async () => {
  await resetAppTables();
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
  return { id: row.id, worktree: row.worktree!, branch: row.branch! };
}

describe("deleting a project", () => {
  it("removes its threads' worktrees from the sandbox instead of stranding them", async () => {
    const project = await newProject();
    const thread = await newThread(project.id);
    await sh(
      local,
      `cd ${thread.worktree} && printf 'x\\n' > a.txt && git add -A && git commit --quiet -m change`,
    );
    expect(existsSync(thread.worktree)).toBe(true);

    const review = `${project.checkoutPath.replace(/\/checkout$/, "")}/reviews/pr-7`;
    await db.insert(codeReviews).values({
      projectId: project.id,
      number: 7,
      url: "https://github.com/acme/web/pull/7",
      headRef: "ta/other",
      baseRef: "main",
      headSha: "a".repeat(40),
      worktree: review,
    });

    const deleted = await call("DELETE", `/projects/${project.id}`);
    expect(deleted.status).toBe(200);
    expect(existsSync(thread.worktree)).toBe(false);
    expect((await db.select().from(codeProjects)).filter((p) => p.id === project.id)).toEqual([]);
    const threads = await db.select().from(codeThreads).where(eq(codeThreads.id, thread.id));
    expect(threads[0]?.projectId).toBeNull();
    expect(threads[0]?.worktree).toBeNull();
  });

  it("still deletes the project when the sandbox is unreachable", async () => {
    const project = await newProject();
    const thread = await newThread(project.id);
    installAppForTests({
      codeGitHub: {
        client: async () => github,
        workspace: async () => {
          throw new Error("sandbox gone");
        },
        credential: async () => "token",
        installationFor: async () => 4242,
        appRepositories: async () => [],
        convertManifest: async () => {
          throw new Error("unused");
        },
      },
    });
    const deleted = await call("DELETE", `/projects/${project.id}`);
    expect(deleted.status).toBe(200);
    expect((await db.select().from(codeProjects)).filter((p) => p.id === project.id)).toEqual([]);
    expect(thread.id).toBeDefined();
  });
});
