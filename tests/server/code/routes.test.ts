import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createShelleyHarness } from "@tiny-agents/code/server";
import { testHost } from "@tiny-agents/code/testing";
import { api, createTestApp } from "../helpers";
import { authToken, eventually, resetAppTables } from "../fixtures";
import { db, guests } from "../../../apps/web/src/server/db";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
import { installAppForTests } from "../../../apps/web/src/server/app-root";
import { isFollowed, markSeen } from "../../../apps/web/src/server/api/code/code.store";
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

  it("lists every harness's threads, marking followed and unread ones", async () => {
    shelley.rows.push(
      row("cA", { max_sequence_id: 9 }),
      row("cB", { parent_conversation_id: "cA", working: true, max_sequence_id: 3 }),
      row("cC", { max_sequence_id: 4 }),
    );
    fake.threads.push((await fake.getThread("t9")).thread);
    fake.emit({ type: "threads" });
    shelley.push({ conversation_list_patch: { patch: [] } });
    await markSeen("shelley", "cA", 5);
    await markSeen("shelley", "cC", 4);
    await eventually(async () => {
      const list = await get<Array<{ id: string; followed: boolean; unread: boolean }>>("/threads");
      expect(list.body.data?.map((r) => [r.id, r.followed, r.unread])).toEqual([
        ["shelley:cA", true, true],
        ["shelley:cB", false, false],
        ["shelley:cC", true, false],
        ["fake:t9", false, false],
      ]);
    });
    const archived = await get<Array<{ id: string }>>("/threads?view=archived");
    expect(archived.body.data?.map((t) => t.id)).toEqual(["shelley:cOld"]);
  });

  it("starts a thread in the named harness with options and follows it", async () => {
    const created = await post<{ threadId: string }>("/threads", {
      instanceId: "shelley",
      message: "run the tests",
      cwd: "/repo",
      model: "claude-opus-5.5",
      effort: "high",
    });
    expect(created.status).toBe(201);
    expect(created.body.data?.threadId).toBe("shelley:cNew1");
    expect(
      JSON.parse(shelley.seen.find((s) => s.url === "/api/conversations/new")!.body.toString()),
    ).toEqual({
      message: "run the tests",
      cwd: "/repo",
      model: "claude-opus-5.5",
      conversation_options: { thinking_level: "high" },
    });
    expect(await isFollowed("shelley:cNew1")).toBe(true);

    const other = await post<{ threadId: string }>("/threads", {
      instanceId: "fake",
      message: "hi",
    });
    expect(other.body.data?.threadId).toBe("fake:t1");
    expect((await post("/threads", { instanceId: "nope", message: "x" })).status).toBe(404);
    expect(
      (
        await post("/threads", {
          instanceId: "shelley",
          message: "x",
          permissionMode: "bypassPermissions",
        })
      ).status,
    ).toBe(400);
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
    const lastTo = (suffix: string) => shelley.seen.filter((x) => x.url.includes(suffix)).at(-1)!;
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
    const calls = () =>
      shelley.seen.filter((s) => !/^\/api\/(stream2|conversations\/snapshot)/.test(s.url)).length;
    const before = calls();
    expect((await post("/threads/..%2Fx/interrupt")).status).toBe(404);
    expect(
      (await get("/harnesses/shelley/diffs/working/file?cwd=/repo&path=../../etc/passwd")).status,
    ).toBe(400);
    expect((await get("/harnesses/shelley/diffs/HEAD~1/files?cwd=/repo")).status).toBe(400);
    expect((await post("/threads/shelley:cA/settings", { system_prompt: "pwned" })).status).toBe(
      400,
    );
    expect((await post("/threads/shelley:cA/queued/..%2Fx/send")).status).toBe(400);
    expect(calls()).toBe(before);
  });

  it("archives a Shelley thread with its subagents", async () => {
    shelley.rows.push(
      row("cA"),
      row("cB", { parent_conversation_id: "cA" }),
      row("cD", { parent_conversation_id: "cB" }),
    );
    const archived = await post<{ moved: string[] }>("/threads/shelley:cA/archive", {
      archived: true,
    });
    expect(archived.status).toBe(200);
    expect(archived.body.data?.moved).toEqual(["shelley:cB", "shelley:cD"]);
  });

  it("holds every harness's file diffs to the same rules: binary and oversized say so", async () => {
    const harness = fake as Partial<FakeHarness>;
    harness.fileDiff = async (_cwd, _diff, path) => ({
      path,
      oldContent: "",
      newContent: path === "logo.png" ? "PNG\0\u0001" : "a".repeat(3_000_000),
    });
    const read = (path: string) =>
      get<{ oldContent: string; newContent: string; unshowable?: string }>(
        `/harnesses/fake/diffs/working/file?cwd=/repo&path=${path}`,
      );
    expect((await read("logo.png")).body.data).toEqual({
      path: "logo.png",
      oldContent: "",
      newContent: "",
      unshowable: "binary",
    });
    expect((await read("big.txt")).body.data).toMatchObject({
      newContent: "",
      unshowable: "tooLarge",
    });
  });

  it("forwards diffs, takes raw uploads, and serves assets sandboxed", async () => {
    const diff = await get<{ path: string }>(
      "/harnesses/shelley/diffs/working/file?cwd=/repo&path=src/a%20b.ts",
    );
    expect(diff.body.data?.path).toBe("src/a b.ts");

    const upload = await app.request("/api/v1/code/uploads/shelley?filename=shot.png", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(upload.status).toBe(201);
    expect(((await upload.json()) as { data: { ref: string } }).data.ref).toBe(
      "file:/tmp/shelley-uploads/x.png",
    );
    expect(shelley.seen.filter((x) => x.url.startsWith("/api/upload/raw")).at(-1)!.body).toEqual(
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

describe("live changes for the Changes panel", () => {
  async function changes(path: string, done: (text: string) => boolean, step?: () => void) {
    const response = await app.request(`/api/v1/code/threads/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let stepped = false;
    while (!done(text)) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      text += decoder.decode(value);
      if (step && !stepped && text.includes('"version":0')) {
        stepped = true;
        step();
      }
    }
    await reader.cancel();
    return text;
  }

  it("sends a new version when the thread's directory changes", async () => {
    fake.stamps.set("/repo", "a");
    const text = await changes(
      "fake:t1/changes?cwd=%2Frepo",
      (s) => s.includes('"version":1'),
      () => fake.stamps.set("/repo", "b"),
    );
    expect(text).toContain('{"type":"changes","version":0}');
    expect(text).toContain('{"type":"changes","version":1}');
  });

  it("never watches a directory a guest names", async () => {
    const guestToken = await authToken("code-changes-guest@example.com", 4343);
    await db.insert(guests).values({ userId: 4343 }).onConflictDoNothing();
    fake.stamps.set("/etc", "a");
    const response = await app.request("/api/v1/code/threads/fake:t9/changes?cwd=%2Fetc", {
      headers: { authorization: `Bearer ${guestToken}` },
    });
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    expect(new TextDecoder().decode(value)).toContain('"type":"unavailable"');
  });

  it("follows any harness that serves diffs, by its own file list, when it has no stamp", async () => {
    const harness = fake as Partial<FakeHarness>;
    delete harness.changeStamp;
    let additions = 1;
    harness.diffFiles = async () => [
      { path: "a.ts", status: "modified", additions, deletions: 0, isGenerated: false },
    ];
    const text = await changes(
      "fake:t1/changes?cwd=%2Frepo",
      (s) => s.includes('"version":1'),
      () => (additions = 2),
    );
    expect(text).toContain('{"type":"changes","version":1}');
  });

  it("watches a Shelley thread too, through Shelley's own diffs", async () => {
    const text = await changes("shelley:s1/changes?cwd=%2Frepo", (s) =>
      /"type":"(changes|unavailable)"/.test(s),
    );
    expect(text).toContain('{"type":"changes","version":0}');
  });

  it("says unavailable only for a harness that serves no diffs at all", async () => {
    const harness = fake as Partial<FakeHarness>;
    delete harness.changeStamp;
    delete harness.diffFiles;
    const text = await changes("fake:t1/changes?cwd=%2Frepo", (s) => s.includes("unavailable"));
    expect(text).toContain('"type":"unavailable"');
  });
});

describe("Code API for a guest (S3)", () => {
  let guestToken = "";
  beforeAll(async () => {
    guestToken = await authToken("code-guest@example.com", 4242);
  });
  const asGuest = <T = unknown>(path: string, init: { method?: string; json?: unknown } = {}) =>
    api<T>(app, `/api/v1/code${path}`, { ...init, token: guestToken });

  beforeEach(async () => {
    await db.insert(guests).values({ userId: 4242 }).onConflictDoNothing();
  });

  it("keeps the harness host to the owner: no browsing, finding, repos, worktrees, uploads or cwd moves", async () => {
    for (const [method, path] of [
      ["GET", "/harnesses/fake/directories"],
      ["GET", "/harnesses/fake/validate-cwd?path=/"],
      ["GET", "/harnesses/fake/find-files?q=x"],
      ["GET", "/harnesses/fake/repos"],
      ["POST", "/harnesses/fake/worktrees"],
      ["POST", "/uploads/fake?filename=x.txt"],
      ["POST", "/threads/fake:t1/cwd"],
    ] as const) {
      expect((await asGuest(path, { method })).status, `${method} ${path}`).toBe(403);
    }
    expect((await get("/harnesses/fake/directories")).status).not.toBe(403);
  });

  it("refuses a guest bypass mode, a chosen directory and file assets", async () => {
    const create = (json: Record<string, unknown>) =>
      asGuest("/threads", { method: "POST", json: { instanceId: "fake", message: "hi", ...json } });
    expect((await create({ permissionMode: "bypassPermissions" })).status).toBe(403);
    expect((await create({ cwd: "/etc" })).status).toBe(403);
    expect(
      (
        await asGuest("/threads/fake:t1/settings", {
          method: "POST",
          json: { permissionMode: "bypassPermissions" },
        })
      ).status,
    ).toBe(403);
    expect((await asGuest("/harnesses/fake/asset?ref=file%3A%2Fetc%2Fpasswd")).status).toBe(403);
    expect((await asGuest("/harnesses/fake/asset?ref=%2Fetc%2Fpasswd")).status).toBe(403);
    expect((await asGuest("/harnesses/fake/asset?ref=img%3Aabc%3A0%3A0")).status).not.toBe(403);
  });

  it("describes each harness to a guest without the owner-only controls", async () => {
    type Caps = {
      threads: { changeCwd: boolean };
      settings: { permissionModes: string[] };
      workspace: { browse: boolean; findFiles: boolean; uploads: boolean; worktrees: boolean };
    };
    const status = await asGuest<{ harnesses: Array<{ id: string; capabilities: Caps }> }>(
      "/status",
    );
    for (const { capabilities } of status.body.data!.harnesses) {
      expect(capabilities.threads.changeCwd).toBe(false);
      expect(capabilities.settings.permissionModes).not.toContain("bypassPermissions");
      expect(capabilities.workspace).toMatchObject({
        browse: false,
        findFiles: false,
        uploads: false,
        worktrees: false,
      });
    }
  });

  it("still lets a guest read and work in threads", async () => {
    expect((await asGuest("/status")).status).toBe(200);
    expect((await asGuest("/threads")).status).toBe(200);
    expect((await asGuest("/harnesses/fake/models")).status).not.toBe(403);
  });
});

describe("a new thread's title", () => {
  afterEach(() => installAppForTests({ codeBranchNamer: undefined }));

  it("is a short summary of the task, from the naming model", async () => {
    installAppForTests({
      codeBranchNamer: {
        sideCaller: {
          complete: async () => "title: Debug gateway log schemas\nbranch: debug-gateway-logs",
        },
      },
    });
    const res = await post<{ threadId: string }>("/threads", {
      instanceId: "fake",
      cwd: "/repo",
      message: "Can you figure out why the gateway log tools fail the schema check in CI?",
    });
    expect(res.status).toBe(201);
    await eventually(() =>
      expect(fake.renamed).toEqual([{ nativeId: "t1", title: "Debug gateway log schemas" }]),
    );
  });
});
