import { userInfo } from "node:os";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { createShelleyHarness } from "@tiny-agents/code/server";
import { testHost } from "@tiny-agents/code/testing";
import { api, createTestApp } from "../helpers";
import { authToken, eventually, resetAppTables, seedBot } from "../fixtures";
import { codeProjects, db, guests } from "../../../apps/web/src/server/db";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import { runsOf } from "../../../apps/web/src/server/api/code/code.runs";
import { recordHandoff } from "../../../apps/web/src/server/api/code/code.store";
import { ensureThread, repointThread } from "../../../apps/web/src/server/api/code/code.threads";
import type { ThreadSnapshot, ThreadSummary } from "@tiny-agents/code/contracts";
import { startFakeShelley, type FakeShelley } from "./shelley/fake-shelley";
import { fakeHarness, type FakeHarness } from "./fake-harness";

const token = await authToken("code-routes@example.com");
const app = createTestApp();
let shelley: FakeShelley;
let fake: FakeHarness;

beforeAll(async () => {
  shelley = await startFakeShelley();
});
afterAll(() => shelley.close());

beforeEach(async () => {
  await resetAppTables();
  shelley.seen.length = 0;
  shelley.rows.length = 0;
  shelley.conversations.clear();
  fake = fakeHarness();
  const hub = setCodeHub(
    createCodeHub({
      instances: [
        createShelleyHarness({
          url: shelley.url,
          host: testHost(),
          stream: { listDebounceMs: 5, minBackoffMs: 20 },
        }),
        fake,
      ],
      listDebounceMs: 5,
    }),
  )!;
  hub.start();
  await shelley.waitForStreams(1);
});

afterEach(() => {
  setCodeHub(undefined);
});

const get = <T = unknown>(path: string) => api<T>(app, `/api/v1/code${path}`, { token });
const post = <T = unknown>(path: string, json?: unknown) =>
  api<T>(app, `/api/v1/code${path}`, {
    method: "POST",
    token,
    ...(json !== undefined ? { json } : {}),
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

async function projectThread(nativeId: string): Promise<string> {
  const [project] = await db
    .insert(codeProjects)
    .values({
      name: "web",
      repoOwner: "acme",
      repoName: "web",
      baseBranch: "main",
      checkoutPath: "/code/acme--web/checkout",
    })
    .onConflictDoUpdate({
      target: [codeProjects.repoOwner, codeProjects.repoName],
      set: { name: "web" },
    })
    .returning();
  return ensureThread("fake", nativeId, {
    projectId: project!.id,
    title: "Fix the login callback",
    branch: "ta/fix-login",
    worktree: "/code/acme--web/worktrees/ta_fix-login",
  });
}

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  conversation_id: id,
  slug: id,
  parent_conversation_id: null,
  working: false,
  updated_at: "x",
  created_at: "x",
  tags: '["tiny-agents"]',
  ...extra,
});

describe("Code API", () => {
  it("describes every harness with its capabilities, and needs the owner's login", async () => {
    const status = await get<{ harnesses: Array<{ id: string; label: string }> }>("/status");
    expect(status.body.data?.harnesses.map((h) => [h.id, h.label])).toEqual([
      ["shelley", "Shelley"],
      ["fake", "Fake"],
    ]);
    expect((await api(app, "/api/v1/code/threads")).status).toBe(401);
  });

  it("tells the editor which SSH host holds each harness's files", async () => {
    type Ssh = {
      host: string | null;
      user: string | null;
      port: number | null;
      keyFile: string | null;
    };
    const ssh = async () =>
      (
        await get<{ harnesses: Array<{ id: string; ssh: Ssh }> }>("/status")
      ).body.data?.harnesses.map((h) => [h.id, h.ssh]);
    try {
      vi.stubEnv("SHELLEY_URL", "http://127.0.0.1:9000");
      vi.stubEnv("SANDBOX_HOST", "127.0.0.1");
      vi.stubEnv("SANDBOX_PORT", "2222");
      vi.stubEnv("SANDBOX_USER", "exedev");
      vi.stubEnv("SANDBOX_SSH_KEY_FILE", "data/sandbox/id_ed25519");
      const local = {
        host: null,
        user: "exedev",
        port: 2222,
        keyFile: `${process.cwd()}/data/sandbox/id_ed25519`,
      };
      expect(await ssh()).toEqual([
        ["shelley", local],
        ["fake", local],
      ]);

      vi.stubEnv("SHELLEY_URL", "http://100.100.200.200:9999");
      vi.stubEnv("SANDBOX_HOST", "tiny-agents-vm");
      vi.stubEnv("SANDBOX_PORT", "22");
      vi.stubEnv("SANDBOX_SSH_KEY_FILE", "");
      expect(await ssh()).toEqual([
        ["shelley", { host: "100.100.200.200", user: "exedev", port: null, keyFile: null }],
        ["fake", { host: "tiny-agents-vm", user: "exedev", port: null, keyFile: null }],
      ]);

      vi.stubEnv("SHELLEY_URL", "http://localhost:9999");
      vi.stubEnv("SANDBOX_HOST", "");
      expect((await ssh())?.[0]).toEqual([
        "shelley",
        { host: null, user: userInfo().username, port: null, keyFile: null },
      ]);

      vi.stubEnv("SANDBOX_HOST", "tiny-agents-vm");
      vi.stubEnv("SANDBOX_USER", "");
      expect((await ssh())?.[1]).toEqual([
        "fake",
        { host: "tiny-agents-vm", user: "exedev", port: null, keyFile: null },
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lists project threads only, under their own ids, with a status", async () => {
    const id = await projectThread("t9");
    fake.threads.push(
      { ...(await fake.getThread("t9")).thread, cursor: 2 },
      (await fake.getThread("tLoose")).thread,
    );
    shelley.rows.push(row("cA", { max_sequence_id: 9 }));
    fake.emit({ type: "threads" });
    shelley.push({ conversation_list_patch: { patch: [] } });
    await eventually(async () => {
      const list = await get<ThreadSummary[]>("/threads");
      expect(list.body.data?.map((t) => [t.id, t.nativeId, t.status])).toEqual([
        [id, "t9", { group: "needs-you", reason: "finished" }],
      ]);
    });
    expect(id).not.toContain(":");
    expect((await post(`/threads/${id}/seen`, { cursor: 2 })).status).toBe(200);
    const read = (await get<ThreadSummary[]>("/threads")).body.data!;
    expect(read[0]).toMatchObject({ unread: false, status: { group: "done", reason: null } });
  });

  it("names who started each thread: a bot, the project chat, or you", async () => {
    const byBot = await projectThread("tBot");
    const byChat = await projectThread("tChat");
    const byYou = await projectThread("tYou");
    const ada = await seedBot({ name: "Ada" });
    const [project] = await db.select().from(codeProjects);
    const lead = await seedBot({ name: "web", projectId: project!.id });
    for (const [bot, threadId] of [
      [ada, byBot],
      [lead, byChat],
    ] as const) {
      await recordHandoff({
        botId: bot.id,
        conversationId: bot.conversationId,
        idempotencyKey: `k-${threadId}`,
        task: "Fix it",
        threadId,
      });
    }
    for (const nativeId of ["tBot", "tChat", "tYou"]) {
      fake.threads.push((await fake.getThread(nativeId)).thread);
    }
    fake.emit({ type: "threads" });
    await eventually(async () => {
      const list = (await get<ThreadSummary[]>("/threads")).body.data ?? [];
      const by = Object.fromEntries(list.map((t) => [t.id, t.startedBy]));
      expect(by).toEqual({
        [byBot]: { botId: ada.id, name: "Ada", project: false },
        [byChat]: { botId: lead.id, name: "web", project: true },
        [byYou]: null,
      });
    });
  });

  it("takes a thread off the list when its agent no longer lists it", async () => {
    await projectThread("tGone");
    fake.emit({ type: "threads" });
    await settle();
    expect((await get<ThreadSummary[]>("/threads")).body.data).toEqual([]);
  });

  it("keeps a thread's id when its conversation is replaced", async () => {
    const id = await projectThread("t9");
    await repointThread(id, "t10");
    const snapshot = (await get<ThreadSnapshot>(`/threads/${id}`)).body.data!;
    expect(snapshot.thread).toMatchObject({ id, nativeId: "t10" });
    expect((await post(`/threads/${id}/messages`, { message: "go on" })).status).toBe(200);
    expect(fake.sent.at(-1)).toMatchObject({ nativeId: "t10", message: "go on" });
  });

  it("records a run per turn: done, failed, and stopped when it was interrupted", async () => {
    const id = await projectThread("t9");
    fake.threads.push((await fake.getThread("t9")).thread);
    fake.emit({ type: "threads" });
    const statuses = async () => (await runsOf(id)).map((run) => [run.trigger, run.status]);

    await post(`/threads/${id}/messages`, { message: "fix it" });
    await post(`/threads/${id}/messages`, { message: "and add a test" });
    expect(await statuses()).toEqual([["owner", "running"]]);
    fake.endTurn("t9");
    await eventually(async () => expect(await statuses()).toEqual([["owner", "done"]]));

    await post(`/threads/${id}/messages`, { message: "again" });
    fake.outcomes.set("t9", { ...(await fake.outcome("t9")), failed: true, text: "boom" });
    fake.endTurn("t9");
    await eventually(async () => expect((await statuses()).at(-1)).toEqual(["owner", "failed"]));
    await eventually(async () => {
      const listed = (await get<ThreadSummary[]>("/threads")).body.data ?? [];
      expect(listed.find((t) => t.id === id)?.status).toEqual({
        group: "needs-you",
        reason: "failed",
      });
    });

    fake.outcomes.delete("t9");
    await post(`/threads/${id}/messages`, { message: "once more" });
    await post(`/threads/${id}/interrupt`);
    fake.endTurn("t9");
    await eventually(async () => expect((await statuses()).at(-1)).toEqual(["owner", "stopped"]));
  });

  it("needs you while the agent waits on a request, until its turn ends", async () => {
    const id = await projectThread("t9");
    fake.threads.push({ ...(await fake.getThread("t9")).thread, working: true });
    fake.emit({ type: "threads" });
    fake.emit({ type: "attention", nativeId: "t9", text: "Wants to run pnpm test", key: "r1" });
    const status = async () =>
      (await get<ThreadSummary[]>("/threads")).body.data?.find((t) => t.id === id)?.status;
    await eventually(async () =>
      expect(await status()).toEqual({ group: "needs-you", reason: "asks you" }),
    );
    fake.endTurn("t9");
    await eventually(async () => expect((await status())?.reason).not.toBe("asks you"));
  });

  it("starts a thread only in a project", async () => {
    expect((await post("/threads", { instanceId: "fake", message: "hi" })).status).toBe(400);
    expect(
      (await post("/threads", { instanceId: "fake", message: "hi", projectId: "nope" })).status,
    ).toBe(404);
    expect(fake.created).toEqual([]);
  });

  it("no longer serves searches, title links or an agent's own diffs", async () => {
    expect((await get("/threads/search?q=x")).status).toBe(404);
    expect((await get("/threads/by-title/x")).status).toBe(404);
    expect((await get("/harnesses/shelley/diffs?cwd=/repo")).status).toBe(404);
    expect((await get("/harnesses/shelley/directories")).status).toBe(404);
  });

  it("steers, queues with skills, stops, and keeps the harness's 404", async () => {
    shelley.conversations.set("cA", { messages: [], conversation: { conversation_id: "cA" } });
    const steer = await post<{ status: string }>("/threads/shelley:cA/messages", {
      message: "use pnpm",
    });
    expect(steer.body.data).toEqual({ status: "accepted" });
    const queued = await post<{ status: string }>("/threads/shelley:cA/messages", {
      message: "then the changelog",
      queue: true,
      skills: ["commit-highlights"],
    });
    expect(queued.body.data).toEqual({ status: "queued" });
    const lastTo = (suffix: string) => shelley.seen.findLast((x) => x.url.includes(suffix))!;
    expect(JSON.parse(lastTo("/chat").body.toString())).toEqual({
      message: "then the changelog",
      queue: true,
      skills: ["commit-highlights"],
    });
    expect((await post("/threads/shelley:cA/interrupt")).status).toBe(200);
    expect((await post("/threads/shelley:cA/queued/q-1/send")).status).toBe(200);
    expect(lastTo("send-queued").url).toBe("/api/conversation/cA/send-queued?queued_id=q-1");
    expect((await post("/threads/shelley:cGone/messages", { message: "hi" })).status).toBe(404);
  });

  it("sends the thread's pending line comments with the next message, once", async () => {
    const draft = (body: unknown) => post("/threads/fake:t1/review/drafts", body);
    expect(
      (await draft({ path: "src/a.ts", startLine: 2, endLine: 3, quote: "b\nc", body: "Rename" }))
        .status,
    ).toBe(201);
    expect(
      (await draft({ path: "old.ts", side: "old", startLine: 7, endLine: 7, body: "Why?" })).status,
    ).toBe(201);

    await post("/threads/fake:t1/messages", { message: "Then run the tests", withReview: true });
    expect(fake.sent.at(-1)).toEqual({
      nativeId: "t1",
      message:
        "Review comments (2):\n\n**`src/a.ts:2-3`**\n```\nb\nc\n```\nRename\n\n---\n\n**`old.ts:7`** (old side)\nWhy?\n\n---\n\nThen run the tests",
      queue: undefined,
    });
    expect((await get<unknown[]>("/threads/fake:t1/review/drafts")).body.data).toEqual([]);

    await post("/threads/fake:t1/messages", { message: "Thanks", withReview: true });
    expect(fake.sent.at(-1)?.message).toBe("Thanks");
  });

  it("lists a harness's app tools and names the picked ones at the top of the message", async () => {
    fake.tools = async () => [
      {
        name: "mcp__github__list_issues",
        label: "List issues",
        description: "List a repository's issues",
        connection: { slug: "github", name: "GitHub" },
      },
    ];
    expect((await get("/harnesses/fake/tools")).body.data).toEqual([
      {
        name: "mcp__github__list_issues",
        label: "List issues",
        description: "List a repository's issues",
        connection: { slug: "github", name: "GitHub" },
      },
    ]);
    expect((await get("/harnesses/shelley/tools")).body.data).toEqual([]);

    const sent = await post("/threads/fake:t1/messages", {
      message: "Triage the new ones",
      tools: ["mcp__github__list_issues", "mcp__github__*"],
    });
    expect(sent.status).toBe(200);
    expect(fake.sent.at(-1)?.message).toBe(
      "Use these tools for this request: mcp__github__list_issues, mcp__github__*. Load any that are not loaded yet before you start.\n\nTriage the new ones",
    );

    const before = fake.sent.length;
    const unknown = await post("/threads/fake:t1/messages", {
      message: "Read my diary",
      tools: ["mcp__diary__read_diary"],
    });
    expect(unknown.status).toBe(400);
    expect(fake.sent).toHaveLength(before);
  });

  it("serves links written before the harness layer (bare Shelley ids)", async () => {
    shelley.conversations.set("cLegacy", {
      messages: [],
      conversation: { conversation_id: "cLegacy", slug: "legacy" },
    });
    const thread = await get<{ thread: { id: string } }>("/threads/cLegacy");
    expect(thread.body.data?.thread.id).toBe("shelley:cLegacy");
  });

  it("answers capability_missing for what a harness cannot do", async () => {
    const before = fake.sent.length;
    const archived = await post("/threads/fake:t1/archive", { archived: true });
    expect(archived.status).toBe(404);
    expect(JSON.stringify(archived.body)).toMatch(/cannot archive/);
    expect((await post("/threads/fake:t1/requests/r1", { decision: "allow" })).status).toBe(404);
    expect((await get("/harnesses/fake/diffs?cwd=/repo")).status).toBe(404);
    expect(fake.sent.length).toBe(before);
  });

  it("rejects odd ids, traversal and unknown settings before calling a harness", async () => {
    const calls = () => shelley.seen.filter((s) => s.method === "POST").length;
    const before = calls();
    expect((await post("/threads/..%2Fx/interrupt")).status).toBe(404);
    expect((await post("/threads/shelley:cA/settings", { system_prompt: "pwned" })).status).toBe(
      400,
    );
    expect((await post("/threads/shelley:cA/queued/..%2Fx/send")).status).toBe(400);
    expect(calls()).toBe(before);
  });

  it("answers 404 for a thread id that is not valid percent-encoding, like an unknown one", async () => {
    for (const bad of ["%zz", "%", "%E0%A4%A"]) {
      expect((await get(`/threads/${bad}`)).status, `GET /threads/${bad}`).toBe(404);
      expect((await post(`/threads/${bad}/messages`, { message: "hi" })).status).toBe(404);
      expect((await post(`/threads/${bad}/archive`, { archived: true })).status).toBe(404);
      expect(
        (await api(app, `/api/v1/code/threads/${bad}`, { method: "DELETE", token })).status,
      ).toBe(404);
    }
    expect((await get("/threads/shelley:cGone")).status).toBe(404);
  });

  it("archives a Shelley thread with its subagents", async () => {
    shelley.rows.push(
      row("cA"),
      row("cB", { parent_conversation_id: "cA" }),
      row("cD", { parent_conversation_id: "cB" }),
    );
    shelley.push({ conversation_list_patch: { patch: [] } });
    await eventually(async () => {
      const archived = await post<{ moved: string[] }>("/threads/shelley:cA/archive", {
        archived: true,
      });
      expect(archived.status).toBe(200);
      expect(archived.body.data?.moved).toEqual(["shelley:cB", "shelley:cD"]);
    });
  });

  it("takes raw uploads and serves assets sandboxed", async () => {
    const upload = await app.request("/api/v1/code/uploads/shelley?filename=shot.png", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(upload.status).toBe(201);
    expect(((await upload.json()) as { data: { ref: string } }).data.ref).toBe(
      "file:/tmp/shelley-uploads/x.png",
    );
    expect(shelley.seen.findLast((x) => x.url.startsWith("/api/upload/raw"))!.body).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect((await post("/uploads/shelley?filename=..%2F..%2Fx")).status).toBe(400);

    const uploadsSeen = () => shelley.seen.filter((r) => r.method === "POST").length;
    const forwarded = uploadsSeen();
    const oversized = await app.request("/api/v1/code/uploads/shelley?filename=big.bin", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "content-length": String(25 * 1024 * 1024 + 1),
      },
      body: new Uint8Array([1]),
    });
    expect(oversized.status).toBe(413);
    expect(((await oversized.json()) as { error: { message: string } }).error.message).toBe(
      "Uploads are limited to 25 MB",
    );
    expect(uploadsSeen()).toBe(forwarded);
    const midsize = await app.request("/api/v1/code/uploads/shelley?filename=log.txt", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
      body: new Uint8Array(2 * 1024 * 1024),
    });
    expect(midsize.status).toBe(201);

    const file = await app.request(
      "/api/v1/code/harnesses/shelley/asset?ref=file%3A%2Ftmp%2Fshot.png",
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("streams a thread: a snapshot, then live events", async () => {
    const response = await app.request("/api/v1/code/threads/fake:tL/events", {
      headers: { authorization: `Bearer ${token}` },
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const read = async (until: (s: string) => boolean) => {
      while (!until(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await read((s) => s.includes('"type":"snapshot"'));
    fake.push("tL", { type: "partial", text: "Working", thinking: "" });
    await read((s) => s.includes("Working"));
    await reader.cancel();
    expect(text).toContain('"type":"partial"');
  });
});

describe("Code is the owner's", () => {
  it("refuses a guest everywhere under /code", async () => {
    const guestToken = await authToken("code-guest@example.com", 4242);
    await db.insert(guests).values({ userId: 4242 }).onConflictDoNothing();
    const asGuest = (path: string, method = "GET") =>
      api(app, `/api/v1/code${path}`, {
        method,
        token: guestToken,
        ...(method === "GET" ? {} : { json: { message: "hi" } }),
      });
    expect((await asGuest("/status")).status).toBe(403);
    expect((await asGuest("/threads")).status).toBe(403);
    expect((await asGuest("/threads/fake:t1/messages", "POST")).status).toBe(403);
    expect(fake.sent).toEqual([]);
  });
});
