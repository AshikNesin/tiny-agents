/**
 * The Code page's curated Shelley proxy (issue #143) against a fake Shelley:
 * owner-only, a fixed allowlist, ids and paths validated before they reach
 * a URL, Shelley's 4xx kept, and the list decorated with followed / unread.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { api, createTestApp } from "../../helpers";
import { authToken, resetAppTables } from "../../fixtures";
import {
  createShelleyHub,
  setShelleyHub,
} from "../../../../apps/web/src/server/api/shelley/shelley.hub";
import { markSeen } from "../../../../apps/web/src/server/api/shelley/shelley.service";
import { descendantIds } from "../../../../apps/web/src/server/api/shelley/shelley.routes";
import { startFakeShelley, type FakeShelley } from "./fake-shelley";

const token = await authToken("shelley-routes@example.com");
const app = createTestApp();
let shelley: FakeShelley;

beforeAll(async () => {
  shelley = await startFakeShelley();
});
afterAll(() => shelley.close());

beforeEach(async () => {
  await resetAppTables();
  shelley.seen.length = 0;
  shelley.rows.length = 0;
  shelley.conversations.clear();
  process.env.SHELLEY_URL = shelley.url;
  setShelleyHub(createShelleyHub({ config: { url: shelley.url } }));
});

afterEach(() => {
  setShelleyHub(undefined);
  delete process.env.SHELLEY_URL;
});

const get = <T = unknown>(path: string) => api<T>(app, `/api/v1/shelley${path}`, { token });
const post = <T = unknown>(path: string, json?: unknown) =>
  api<T>(app, `/api/v1/shelley${path}`, {
    method: "POST",
    token,
    ...(json !== undefined ? { json } : {}),
  });

describe("Shelley proxy", () => {
  it("says when Shelley is not configured, and needs the owner's login", async () => {
    setShelleyHub(undefined);
    delete process.env.SHELLEY_URL;
    const status = await get<{ configured: boolean }>("/status");
    expect(status.body.data).toMatchObject({
      configured: false,
      connection: { state: "disabled" },
    });
    expect((await get("/conversations")).status).toBe(503);
    process.env.SHELLEY_URL = shelley.url;
    expect((await api(app, "/api/v1/shelley/conversations")).status).toBe(401);
  });

  it("lists conversations with subagents, marking followed and unread ones", async () => {
    shelley.rows.push(
      {
        conversation_id: "cA",
        slug: "a",
        parent_conversation_id: null,
        working: false,
        max_sequence_id: 9,
        updated_at: "x",
        created_at: "x",
      },
      {
        conversation_id: "cB",
        slug: "b",
        parent_conversation_id: "cA",
        working: true,
        max_sequence_id: 3,
        updated_at: "x",
        created_at: "x",
      },
      {
        conversation_id: "cC",
        slug: "c",
        parent_conversation_id: null,
        working: false,
        max_sequence_id: 4,
        updated_at: "x",
        created_at: "x",
      },
    );
    await markSeen("cA", 5);
    await markSeen("cC", 4);
    const list =
      await get<Array<{ conversation_id: string; followed: boolean; unread: boolean }>>(
        "/conversations",
      );
    expect(list.body.data?.map((r) => [r.conversation_id, r.followed, r.unread])).toEqual([
      ["cA", true, true],
      ["cB", false, false],
      ["cC", true, false],
    ]);
    const snapshot = shelley.seen.find((s) => s.url === "/api/conversations/snapshot")!;
    expect(snapshot.headers["x-exedev-userid"]).toBeTruthy();
    expect(snapshot.headers["x-shelley-request"]).toBe("1");
    const archived = await get<Array<{ conversation_id: string }>>("/conversations?view=archived");
    expect(archived.body.data?.[0].conversation_id).toBe("cOld");
  });

  it("starts a conversation with options and follows it", async () => {
    const created = await post<{ conversationId: string }>("/conversations", {
      message: "run the tests",
      cwd: "/repo",
      model: "claude-opus-5.5",
      thinkingLevel: "high",
    });
    expect(created.status).toBe(201);
    const sent = JSON.parse(
      shelley.seen.find((s) => s.url === "/api/conversations/new")!.body.toString(),
    );
    expect(sent).toEqual({
      message: "run the tests",
      cwd: "/repo",
      model: "claude-opus-5.5",
      conversation_options: { thinking_level: "high" },
    });
    const list = await get<Array<{ conversation_id: string; followed: boolean }>>("/conversations");
    expect(list.status).toBe(200);
  });

  it("steers, queues with skills, stops, and keeps Shelley's 404", async () => {
    shelley.conversations.set("cA", { messages: [], conversation: { conversation_id: "cA" } });
    const steer = await post<{ status: string }>("/conversations/cA/chat", { message: "use pnpm" });
    expect(steer.body.data).toEqual({ status: "accepted" });
    const queued = await post<{ status: string }>("/conversations/cA/chat", {
      message: "then the changelog",
      queue: true,
      skills: ["commit-highlights"],
    });
    expect(queued.body.data).toEqual({ status: "queued" });
    expect(JSON.parse(shelley.seen.at(-1)!.body.toString())).toEqual({
      message: "then the changelog",
      queue: true,
      skills: ["commit-highlights"],
    });
    expect((await post("/conversations/cA/cancel")).status).toBe(200);
    expect((await post("/conversations/cA/queued/send?queuedId=q-1")).status).toBe(200);
    expect(shelley.seen.at(-1)!.url).toBe("/api/conversation/cA/send-queued?queued_id=q-1");
    expect((await post("/conversations/cGone/chat", { message: "hi" })).status).toBe(404);
  });

  it("rejects odd ids, traversal and unknown settings before calling Shelley", async () => {
    const before = shelley.seen.length;
    expect((await post("/conversations/..%2Fx/cancel")).status).toBe(400);
    expect((await get("/diffs/working/file?cwd=/repo&path=../../etc/passwd")).status).toBe(400);
    expect((await get("/diffs/HEAD~1/files?cwd=/repo")).status).toBe(400);
    expect((await post("/conversations/cA/settings", { system_prompt: "pwned" })).status).toBe(400);
    expect((await post("/conversations/cA/queued/send")).status).toBe(400);
    expect(shelley.seen.length).toBe(before);
  });

  it("archives a conversation with its subagents, and unarchives them together", async () => {
    const row = (id: string, parent: string | null) => ({
      conversation_id: id,
      slug: id,
      parent_conversation_id: parent,
      working: false,
      updated_at: "x",
      created_at: "x",
    });
    shelley.rows.push(row("cA", null), row("cB", "cA"), row("cD", "cB"), row("cC", null));
    const archived = await post<{ subagents: string[] }>("/conversations/cA/archive");
    expect(archived.status).toBe(200);
    expect(archived.body.data?.subagents).toEqual(["cB", "cD"]);
    const calls = shelley.seen.map((s) => s.url).filter((u) => u.endsWith("/archive"));
    expect(calls).toEqual([
      "/api/conversation/cA/archive",
      "/api/conversation/cB/archive",
      "/api/conversation/cD/archive",
    ]);
    // The archived list has no subagents of cOld: only cOld moves.
    const restored = await post<{ subagents: string[] }>("/conversations/cOld/unarchive");
    expect(restored.body.data?.subagents).toEqual([]);
  });

  it("finds descendants without looping on a cycle", () => {
    const rows = [
      { conversation_id: "a", parent_conversation_id: "c" },
      { conversation_id: "b", parent_conversation_id: "a" },
      { conversation_id: "c", parent_conversation_id: "b" },
    ] as unknown as Parameters<typeof descendantIds>[0];
    expect(descendantIds(rows, "a")).toEqual(["b", "c"]);
  });

  it("forwards diffs per path segment, uploads raw bodies, and serves files sandboxed", async () => {
    const diff = await get<{ path: string }>("/diffs/working/file?cwd=/repo&path=src/a%20b.ts");
    expect(diff.body.data?.path).toBe("src/a b.ts");
    expect(shelley.seen.at(-1)!.url).toBe("/api/git/file-diff/working/src/a%20b.ts?cwd=%2Frepo");

    const upload = await app.request("/api/v1/shelley/uploads?filename=shot.png", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(upload.status).toBe(201);
    expect(((await upload.json()) as { data: { path: string } }).data.path).toBe(
      "/tmp/shelley-uploads/x.png",
    );
    expect(shelley.seen.at(-1)!.body).toEqual(Buffer.from([1, 2, 3]));
    expect((await post("/uploads?filename=..%2F..%2Fx")).status).toBe(400);

    const file = await app.request("/api/v1/shelley/files?path=/tmp/shot.png", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("streams status and list events, and one conversation's frames", async () => {
    const hub = createShelleyHub({ config: { url: shelley.url }, listDebounceMs: 10 });
    setShelleyHub(hub);
    hub.start();
    await shelley.waitForStreams(1);
    const response = await app.request("/api/v1/shelley/events?conversation=cA&list=0", {
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
    await read((s) => s.includes('"type":"status"'));
    shelley.push({ conversation_id: "cZ", tool_progress: { tool_use_id: "z", output: "other" } });
    shelley.push({ conversation_id: "cA", tool_progress: { tool_use_id: "t", output: "PASS" } });
    await read((s) => s.includes("PASS"));
    await reader.cancel();
    expect(text).toContain('"type":"frame"');
    expect(text).not.toContain("other");
    expect(text).not.toContain('"type":"list"');
    hub.stop();
  });
});
