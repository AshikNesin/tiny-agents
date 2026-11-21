import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { createShelleyHarness } from "@tiny-agents/code/server";
import { testHost } from "@tiny-agents/code/testing";
import { createCodeToolkit } from "../../../packages/agent/src/toolkits/code";
import { defaultPermission, effectivePermission } from "../../../packages/agent/src/capabilities";
import { db, bots, codeHandoffs } from "../../../apps/web/src/server/db";
import { codeStore } from "../../../apps/web/src/server/api/code/code.bots";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import { finishHandoffOnce, isFollowed } from "../../../apps/web/src/server/api/code/code.store";
import { installAppForTests } from "../../../apps/web/src/server/app-root";
import { eventually, resetAppTables, TEST_MODEL } from "../fixtures";
import { startFakeShelley, type FakeShelley } from "./shelley/fake-shelley";
import { fakeHarness, type FakeHarness } from "./fake-harness";

let shelley: FakeShelley;
let fake: FakeHarness;

afterEach(async () => {
  setCodeHub(undefined);
  await shelley.close();
});
beforeEach(async () => {
  await resetAppTables();
  shelley = await startFakeShelley();
  fake = fakeHarness("claude-code", {
    workspace: {
      diffs: false,
      findFiles: false,
      uploads: false,
      skills: false,
      browse: false,
      worktrees: false,
      requiresCwd: true,
    },
    settings: {
      modelSwitch: false,
      effortLevels: [],
      permissionModes: ["default", "acceptEdits"],
      defaultPermissionMode: "acceptEdits",
    },
  });
  setCodeHub(
    createCodeHub({
      instances: [createShelleyHarness({ url: shelley.url, host: testHost() }), fake],
    }),
  );
  await db.insert(bots).values([
    { name: "Coder", modelId: TEST_MODEL, conversationId: "101" },
    { name: "Other", modelId: TEST_MODEL, conversationId: "202" },
  ]);
});

const ok = <T extends object>(value: T | { error: string }): T => {
  if ("error" in value) throw new Error(value.error);
  return value;
};

describe("code hand-off store", () => {
  it("starts in Shelley by default, once per tool task, and follows the thread", async () => {
    const first = ok(
      await codeStore.start({
        conversationId: 101,
        idempotencyKey: "task-1",
        task: "fix the login test",
        cwd: "/repo",
      }),
    );
    const replay = await codeStore.start({
      conversationId: 101,
      idempotencyKey: "task-1",
      task: "fix the login test",
      cwd: "/repo",
    });
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      threadId: "shelley:cNew1",
      harness: "Shelley",
      status: "running",
      cwd: "/repo",
      url: "/code/shelley%3AcNew1",
    });
    expect(shelley.seen.filter((s) => s.url === "/api/conversations/new")).toHaveLength(1);
    expect(await isFollowed("shelley:cNew1")).toBe(true);
    expect((await codeStore.list(101)).map((h) => h.threadId)).toEqual(["shelley:cNew1"]);
    expect(await codeStore.harnesses()).toEqual([
      { id: "shelley", label: "Shelley", isDefault: true },
      { id: "claude-code", label: "Fake", isDefault: false },
    ]);
  });

  it("starts in a named harness in its default permission mode, and needs a cwd when it does", async () => {
    expect(
      await codeStore.start({
        conversationId: 101,
        idempotencyKey: "task-2",
        task: "t",
        harness: "claude-code",
      }),
    ).toEqual({ error: "Fake needs a working directory: pass cwd (the repo's path)." });
    const started = ok(
      await codeStore.start({
        conversationId: 101,
        idempotencyKey: "task-3",
        task: "t",
        harness: "claude-code",
        cwd: "/repo",
      }),
    );
    expect(started.threadId).toBe("claude-code:t1");
    expect(fake.created[0]).toMatchObject({ cwd: "/repo", permissionMode: "acceptEdits" });
    expect(
      await codeStore.start({
        conversationId: 101,
        idempotencyKey: "task-4",
        task: "t",
        harness: "nope",
      }),
    ).toEqual({ error: 'No harness "nope". Available: shelley, claude-code.' });
  });

  it("adopts an existing thread on send, and re-arms a finished hand-off on follow-up", async () => {
    shelley.conversations.set("cExisting", {
      messages: [],
      conversation: {
        conversation_id: "cExisting",
        slug: "old-work",
        cwd: "/repo",
        agent_working: false,
      },
    });
    expect(
      await codeStore.send({
        conversationId: 202,
        idempotencyKey: "send-1",
        threadId: "shelley:cMissing",
        message: "x",
      }),
    ).toEqual({ error: "not_found" });
    expect(
      await codeStore.send({
        conversationId: 202,
        idempotencyKey: "send-2",
        threadId: "shelley:cExisting",
        message: "continue",
      }),
    ).toEqual({ status: "accepted" });
    expect(await codeStore.list(202)).toMatchObject([
      { threadId: "shelley:cExisting", title: "old-work", cwd: "/repo", status: "running" },
    ]);
    expect(await codeStore.list(101)).toEqual([]);

    const handoff = ok(
      await codeStore.start({ conversationId: 101, idempotencyKey: "task-5", task: "t" }),
    );
    const [row] = await db
      .select()
      .from(codeHandoffs)
      .where(eq(codeHandoffs.threadId, handoff.threadId));
    expect(await finishHandoffOnce(row!.id)).toBe(true);
    expect(await finishHandoffOnce(row!.id)).toBe(false);
    expect(
      await codeStore.send({
        conversationId: 101,
        idempotencyKey: "send-3",
        threadId: handoff.threadId,
        message: "also logout",
        queue: true,
      }),
    ).toEqual({ status: "queued" });
    const [after] = await db.select().from(codeHandoffs).where(eq(codeHandoffs.id, row!.id));
    expect(after!.status).toBe("running");
  });

  it("lists a harness's ready models, its default first", async () => {
    expect(await codeStore.models()).toEqual([
      { id: "glm-5-3-zai-int-exe-xyz", name: "GLM 5.3", isDefault: true },
      { id: "claude-opus-5.5", isDefault: false },
    ]);
    expect(await codeStore.models("claude-code")).toEqual([
      { id: "m1", name: "Model One", isDefault: true },
    ]);
  });

  it("reports status with the working tree's changed files", async () => {
    const handoff = ok(
      await codeStore.start({
        conversationId: 101,
        idempotencyKey: "task-6",
        task: "t",
        cwd: "/repo",
      }),
    );
    const status = await codeStore.status({ conversationId: 101, threadId: handoff.threadId });
    expect(status).toMatchObject({
      harness: "Shelley",
      working: true,
      url: `/code/${encodeURIComponent(handoff.threadId)}`,
    });
    expect(status?.changedFiles).toEqual([
      { path: "math.js", status: "modified", additions: 4, deletions: 0 },
    ]);
  });
});

describe("code toolkit", () => {
  it("offers its tools only when a harness is configured", () => {
    const off = createCodeToolkit({ setupHint: "Set SHELLEY_URL" });
    expect(off.setupHint).toBe("Set SHELLEY_URL");
    expect(off.extension.tools ?? []).toHaveLength(0);
    const on = createCodeToolkit({ store: codeStore });
    expect((on.extension.tools ?? []).map((t) => t.name)).toEqual([
      "code_start",
      "code_send",
      "code_status",
      "code_list",
      "code_models",
      "shelley_start",
      "shelley_send",
    ]);
    expect(on.tools.map((t) => [t.name, defaultPermission(t)])).toEqual([
      ["code_start", "allow"],
      ["code_send", "allow"],
      ["code_status", "allow"],
      ["code_list", "allow"],
      ["code_models", "allow"],
      ["shelley_start", "allow"],
      ["shelley_send", "allow"],
    ]);
    expect(effectivePermission(on.tools[0]!, { code_start: "ask" })).toBe("ask");
  });
});

describe("a hand-off thread's title", () => {
  afterEach(() => installAppForTests({ codeBranchNamer: undefined }));

  it("is a short summary of the task, like a thread the owner starts", async () => {
    installAppForTests({
      codeBranchNamer: {
        sideCaller: { complete: async () => "title: Fix login redirect\nbranch: fix-login" },
      },
    });
    ok(
      await codeStore.start({
        conversationId: 101,
        idempotencyKey: "titled-1",
        harness: "claude-code",
        task: "The login page redirects to /404 after a password reset. Find out why and fix it.",
        cwd: "/repo",
      }),
    );
    await eventually(() =>
      expect(fake.renamed).toEqual([{ nativeId: "t1", title: "Fix login redirect" }]),
    );
  });
});
