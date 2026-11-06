/**
 * The Shelley harness against a fake Shelley speaking the real wire format:
 * one stream2 connection feeds the list, per-thread watchers, turn ends and
 * `message_user` calls; every call goes through Shelley's official API.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { InstanceEvent, ThreadEvent } from "@tiny-agents/code/contracts";
import { createShelleyHarness, type ShelleyHarness } from "@tiny-agents/code/server";
import {
  capabilityProblems,
  collect,
  testHost,
  threadEventProblems,
} from "@tiny-agents/code/testing";
import { eventually, startFakeShelley, type FakeShelley } from "./fake-shelley";
import { describeTurnOutcomeRule, type TurnCase } from "../turn-outcome-conformance";

let shelley: FakeShelley;
let harness: ShelleyHarness;

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  conversation_id: id,
  slug: `slug-${id}`,
  parent_conversation_id: null,
  working: false,
  updated_at: "2026-11-05T00:00:00Z",
  created_at: "2026-11-05T00:00:00Z",
  cwd: "/repo",
  model: null,
  ...extra,
});

const agent = (seq: number, content: unknown[], extra: Record<string, unknown> = {}) => ({
  message_id: `m${seq}`,
  sequence_id: seq,
  type: "agent",
  created_at: "2026-11-05T00:00:00Z",
  llm_data: JSON.stringify({ Content: content }),
  ...extra,
});

const user = (seq: number, text: string) => ({
  message_id: `m${seq}`,
  sequence_id: seq,
  type: "user",
  created_at: "2026-11-05T00:00:00Z",
  llm_data: JSON.stringify({ Content: [{ Type: 2, Text: text }] }),
});

const error = (seq: number, text: string) => ({
  message_id: `m${seq}`,
  sequence_id: seq,
  type: "error",
  created_at: "2026-11-05T00:00:00Z",
  llm_data: JSON.stringify({ Content: [{ Type: 2, Text: text }] }),
});

const said = (text: string) => [{ Type: 2, Text: text }];
const endOfTurn = { end_of_turn: true };

beforeEach(async () => {
  shelley = await startFakeShelley();
  shelley.rows.push(row("cA"));
  harness = createShelleyHarness({
    url: `${shelley.url}/`,
    host: testHost(),
    stream: { listDebounceMs: 10, minBackoffMs: 20, maxBackoffMs: 40 },
  });
});

afterEach(async () => {
  harness.stop();
  await shelley.close();
});

describe("Shelley harness", () => {
  it("is honest about its capabilities", () => {
    expect(capabilityProblems(harness)).toEqual([]);
    expect(harness.capabilities().approvals).toEqual({ tools: false, questions: false });
    expect(harness.capabilities().settings.permissionModes).toEqual([]);
  });

  it("holds one stream, lists threads and re-reads the list when Shelley says it changed", async () => {
    const events: InstanceEvent[] = [];
    harness.subscribe((e) => events.push(e));
    harness.start();
    await shelley.waitForStreams(1);
    await eventually(() => expect(harness.status()).toEqual({ state: "connected" }));
    const [a] = await harness.listThreads("active");
    expect(a).toMatchObject({
      id: "shelley:cA",
      instanceId: "shelley",
      kind: "shelley",
      nativeId: "cA",
      title: "slug-cA",
      cwd: "/repo",
      parentId: null,
      working: false,
    });

    shelley.rows.push(row("cB", { parent_conversation_id: "cA" }));
    shelley.push({ conversation_list_patch: { patch: [{ op: "add", path: "/1" }] } });
    await eventually(async () => {
      const list = await harness.listThreads("active");
      expect(list.find((t) => t.nativeId === "cB")?.parentId).toBe("shelley:cA");
    });
    expect(events.some((e) => e.type === "threads")).toBe(true);
    expect(events.some((e) => e.type === "connected")).toBe(true);
    expect(shelley.seen.filter((s) => s.url === "/api/stream2")).toHaveLength(1);
    expect(shelley.seen[0]!.headers["x-shelley-request"]).toBe("1");
    expect(shelley.seen[0]!.headers["x-exedev-userid"]).toBeTruthy();
  });

  it("reports turn ends once, with the outcome read after the end, and message_user calls as attention", async () => {
    shelley.conversations.set("cA", {
      messages: [user(1, "go"), agent(6, said("All green."), endOfTurn)],
      conversation: row("cA"),
    });
    const events: InstanceEvent[] = [];
    harness.subscribe((e) => events.push(e));
    harness.start();
    await shelley.waitForStreams(1);

    shelley.push({ conversation_id: "cA", conversation_state: { working: true } });
    shelley.push({
      conversation_id: "cA",
      messages: [
        agent(5, [{ Type: 5, ID: "t9", ToolName: "message_user", ToolInput: { text: "Key?" } }]),
      ],
    });
    shelley.push({
      conversation_id: "cA",
      conversation_state: { working: false },
      notification_event: { type: "agent_done", payload: { final_response: "All green." } },
    });
    shelley.push({ conversation_id: "cA", conversation_state: { working: false } });

    await eventually(() =>
      expect(events.filter((e) => e.type === "turn_ended")).toEqual([
        {
          type: "turn_ended",
          nativeId: "cA",
          outcome: {
            working: false,
            title: "slug-cA",
            cwd: "/repo",
            text: "All green.",
            failed: false,
            endedAt: Date.parse("2026-11-05T00:00:00Z"),
            cursor: 6,
          },
        },
      ]),
    );
    expect(events.find((e) => e.type === "attention")).toEqual({
      type: "attention",
      nativeId: "cA",
      text: "Key?",
      key: "cA:5",
    });
  });

  it("watches a thread: Shelley's frames become rows, partial text and state", async () => {
    shelley.conversations.set("cA", {
      messages: [user(1, "Fix the tests"), agent(2, [{ Type: 2, Text: "On it." }])],
      conversation: row("cA", { agent_working: true }),
    });
    harness.start();
    await shelley.waitForStreams(1);
    const watcher = collect();
    const stop = harness.watchThread("cA", watcher.listener);

    const first = await watcher.next((e) => e.type === "snapshot");
    const snapshot = (first as Extract<ThreadEvent, { type: "snapshot" }>).snapshot;
    expect(snapshot.items.map((i) => i.kind)).toEqual(["user", "assistant"]);
    expect(snapshot.thread).toMatchObject({ id: "shelley:cA", working: true, cursor: 2 });

    shelley.push({ conversation_id: "cA", stream_delta: { type: "text", text: "Run" } });
    expect(await watcher.next((e) => e.type === "partial")).toEqual({
      type: "partial",
      text: "Run",
      thinking: "",
    });

    shelley.push({
      conversation_id: "cA",
      messages: [
        agent(3, [{ Type: 5, ID: "tool1", ToolName: "bash", ToolInput: { command: "pnpm test" } }]),
      ],
    });
    const added = (await watcher.next((e) => e.type === "items")) as Extract<
      ThreadEvent,
      { type: "items" }
    >;
    expect(added.items).toEqual([expect.objectContaining({ id: "tool1", status: "running" })]);
    expect(added.cursor).toBe(3);

    // Live output updates the same row.
    shelley.push({
      conversation_id: "cA",
      tool_progress: { tool_use_id: "tool1", tool_name: "bash", output: "PASS 1" },
    });
    const live = (await watcher.next((e) => e.type === "items")) as Extract<
      ThreadEvent,
      { type: "items" }
    >;
    expect(live.items).toContainEqual(
      expect.objectContaining({ id: "tool1", output: "PASS 1", live: true }),
    );

    shelley.push({ conversation_id: "cA", conversation_state: { working: false } });
    expect(await watcher.next((e) => e.type === "state")).toMatchObject({ working: false });
    expect(threadEventProblems(watcher.events)).toEqual([]);
    stop();
  });

  it("starts a watched thread over from a fresh read after the stream reconnects", async () => {
    shelley.conversations.set("cA", { messages: [user(1, "hi")], conversation: row("cA") });
    harness.start();
    await shelley.waitForStreams(1);
    await eventually(() => expect(harness.status()).toEqual({ state: "connected" }));
    const watcher = collect();
    harness.watchThread("cA", watcher.listener);
    await watcher.next((e) => e.type === "snapshot");

    // A message lands while the stream is down.
    shelley.conversations.get("cA")!.messages.push(agent(2, [{ Type: 2, Text: "missed?" }]));
    shelley.dropStreams();
    const caught = (await watcher.next((e) => e.type === "snapshot", 4000)) as Extract<
      ThreadEvent,
      { type: "snapshot" }
    >;
    expect(caught.snapshot.items.at(-1)).toMatchObject({ kind: "assistant", text: "missed?" });
    expect(threadEventProblems(watcher.events)).toEqual([]);
  });

  it("starts, sends (steer or queue, with attachments) and stops through Shelley's API", async () => {
    harness.start();
    const { nativeId } = await harness.createThread({
      message: "Add a test",
      cwd: "/repo",
      model: "glm",
      effort: "high",
      attachments: ["file:/tmp/shelley-uploads/x.png"],
    });
    expect(nativeId).toBe("cNew1");
    const created = JSON.parse(
      shelley.seen.find((s) => s.url === "/api/conversations/new")!.body.toString(),
    );
    expect(created).toEqual({
      message: "Add a test\n\n[/tmp/shelley-uploads/x.png]",
      cwd: "/repo",
      model: "glm",
      conversation_options: { thinking_level: "high" },
    });

    expect(await harness.send(nativeId, { message: "also lint" })).toEqual({ status: "accepted" });
    expect(await harness.send(nativeId, { message: "then docs", queue: true })).toEqual({
      status: "queued",
    });
    await harness.interrupt(nativeId);
    expect(shelley.seen.map((s) => s.url)).toContain("/api/conversation/cNew1/cancel");
  });

  it("archives a thread with its subagents", async () => {
    shelley.rows.push(row("cB", { parent_conversation_id: "cA" }));
    shelley.rows.push(row("cC", { parent_conversation_id: "cB" }));
    harness.start();
    await shelley.waitForStreams(1);
    expect(await harness.archive!("cA", true)).toEqual({ moved: ["cB", "cC"] });
    const archived = shelley.seen.filter((s) => s.url.endsWith("/archive")).map((s) => s.url);
    expect(archived).toEqual([
      "/api/conversation/cA/archive",
      "/api/conversation/cB/archive",
      "/api/conversation/cC/archive",
    ]);
  });

  it("serves the composer: models, uploads, diffs and assets", async () => {
    const models = await harness.models();
    expect(models.find((m) => m.isDefault)).toMatchObject({
      id: "glm-5-3-zai-int-exe-xyz",
      label: "GLM 5.3",
    });
    expect(await harness.upload!(new Blob(["x"]), "x.png")).toEqual({
      ref: "file:/tmp/shelley-uploads/x.png",
    });
    expect(await harness.diffFiles!("/repo", "working")).toEqual([
      expect.objectContaining({ path: "math.js", status: "modified" }),
    ]);
    expect(await harness.fileDiff!("/repo", "working", "src/a b.ts")).toMatchObject({
      oldContent: "a\n",
    });
    expect(shelley.seen.at(-1)!.url).toBe("/api/git/file-diff/working/src/a%20b.ts?cwd=%2Frepo");
    const asset = await harness.asset!("file:/tmp/shelley-uploads/x.png");
    expect(asset.headers.get("content-type")).toBe("image/png");
    await expect(harness.asset!("file:/tmp/../etc/passwd")).rejects.toThrow(/Unknown asset/);
    await expect(harness.fileDiff!("/repo", "working", "../x")).rejects.toThrow(/Invalid path/);
  });

  it("reads one Shelley message's text blocks as one answer", async () => {
    shelley.conversations.set("cA", {
      messages: [user(1, "go"), agent(2, [...said("Done:"), ...said("3 files.")], endOfTurn)],
      conversation: row("cA"),
    });
    expect(await harness.outcome("cA")).toMatchObject({ text: "Done:\n3 files.", cursor: 2 });
  });

  it("reports Shelley unreachable with the reason", async () => {
    await shelley.close();
    harness.start();
    await eventually(() => expect(harness.status().state).toBe("reconnecting"));
    expect(harness.status().detail).toMatch(/unreachable/);
    shelley = await startFakeShelley();
  });
});

describeTurnOutcomeRule("Shelley", async (turn: TurnCase) => {
  const messages = {
    answered: [user(1, "go"), agent(2, said("Done: 3 files."), endOfTurn)],
    failed: [user(1, "go"), error(2, "boom")],
    // Stopped after the steer: Shelley ends the turn with nothing more to say.
    steered: [
      user(1, "task"),
      agent(2, said("Halfway.")),
      user(3, "also docs"),
      agent(4, [], endOfTurn),
    ],
    // The second turn was cancelled before Shelley wrote anything.
    unanswered: [user(1, "one"), agent(2, said("First done."), endOfTurn), user(3, "two")],
  }[turn];
  shelley.conversations.set("cT", { messages, conversation: row("cT") });
  const events: InstanceEvent[] = [];
  harness.subscribe((e) => events.push(e));
  harness.start();
  await shelley.waitForStreams(1);
  shelley.push({ conversation_id: "cT", conversation_state: { working: true } });
  shelley.push({ conversation_id: "cT", conversation_state: { working: false } });
  await eventually(() => expect(events.some((e) => e.type === "turn_ended")).toBe(true));
  return { harness, nativeId: "cT", events };
});
