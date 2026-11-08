/**
 * The Code API (ADR 0011): one route set for every harness, owner-only,
 * ids and paths validated before they reach a harness, harness errors kept,
 * capabilities enforced, and the list decorated with followed / unread.
 * Shelley runs through its real driver against the fake Shelley; a second,
 * fake harness proves nothing here is Shelley-specific.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { createShelleyHarness } from "@tiny-agents/code/server";
import { testHost } from "@tiny-agents/code/testing";
import { api, createTestApp } from "../helpers";
import { authToken, eventually, resetAppTables } from "../fixtures";
import { createCodeHub, setCodeHub } from "../../../apps/web/src/server/api/code/code.hub";
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
    // A permission mode the harness does not enforce is refused, never faked.
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
    // The stream and its list reads run in the background; count the rest.
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

    // Over the route's own limit (not the app's 1 MB default): a worded 413,
    // before the body is read or forwarded.
    const forwarded = shelley.seen.length;
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
    expect(shelley.seen.length).toBe(forwarded);
    // Bigger than the app's 1 MB API default, within the route's 25 MB.
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
