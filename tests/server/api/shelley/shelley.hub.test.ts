/**
 * ShelleyHub (issue #143): one stream2 connection feeds the list, per-
 * conversation viewers and turn ends, and survives Shelley going away.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createShelleyHub,
  type ShelleyFrame,
  type ShelleyHub,
  type TurnEnd,
} from "../../../../apps/web/src/server/api/shelley/shelley.hub";
import { eventually, startFakeShelley, type FakeShelley } from "./fake-shelley";

let shelley: FakeShelley;
let hub: ShelleyHub;

beforeEach(async () => {
  shelley = await startFakeShelley();
  shelley.rows.push({
    conversation_id: "cA",
    slug: "fix-tests",
    parent_conversation_id: null,
    working: false,
    updated_at: "x",
    created_at: "x",
    cwd: null,
    model: null,
  });
  hub = createShelleyHub({
    config: { url: shelley.url },
    listDebounceMs: 10,
    minBackoffMs: 20,
    maxBackoffMs: 40,
  });
});

afterEach(async () => {
  hub.stop();
  await shelley.close();
});

describe("ShelleyHub", () => {
  it("holds one stream, reads the list and re-reads it when Shelley says it changed", async () => {
    hub.start();
    await shelley.waitForStreams(1);
    await eventually(() => expect(hub.list()?.map((r) => r.conversation_id)).toEqual(["cA"]));
    expect(hub.status()).toEqual({ state: "connected" });

    shelley.rows.push({
      conversation_id: "cB",
      slug: "sub",
      parent_conversation_id: "cA",
      updated_at: "x",
      created_at: "x",
      cwd: null,
      model: null,
    });
    shelley.push({
      conversation_list_patch: {
        old_hash: "h",
        new_hash: "h2",
        patch: [{ op: "add", path: "/1" }],
      },
    });
    await eventually(() => expect(hub.list()).toHaveLength(2));
    expect(shelley.seen.filter((s) => s.url === "/api/stream2")).toHaveLength(1);
    expect(shelley.seen[0].headers["x-shelley-request"]).toBe("1");
  });

  it("fans frames out per conversation, counts viewers, and reports turn ends once", async () => {
    const forA: ShelleyFrame[] = [];
    const ends: TurnEnd[] = [];
    const off = hub.subscribe("cA", (f) => forA.push(f));
    hub.onTurnEnd((e) => ends.push(e));
    expect(hub.viewers("cA")).toBe(1);
    hub.start();
    await shelley.waitForStreams(1);

    shelley.push({ conversation_id: "cA", conversation_state: { working: true } });
    shelley.push({
      conversation_id: "cZ",
      tool_progress: { tool_use_id: "t", tool_name: "bash", output: "x" },
    });
    shelley.push({
      conversation_id: "cA",
      tool_progress: { tool_use_id: "t1", tool_name: "bash", output: "PASS" },
    });
    // Shelley sends agent_done in the same frame as working:false.
    shelley.push({
      conversation_id: "cA",
      conversation_state: { working: false },
      notification_event: {
        type: "agent_done",
        conversation_id: "cA",
        payload: { final_response: "All green." },
      },
    });
    shelley.push({ conversation_id: "cA", conversation_state: { working: false } });

    await eventually(() =>
      expect(ends).toEqual([{ conversationId: "cA", finalResponse: "All green." }]),
    );
    expect(forA.map((f) => Object.keys(f).filter((k) => k !== "conversation_id"))).toEqual([
      ["conversation_state"],
      ["tool_progress"],
      ["conversation_state", "notification_event"],
      ["conversation_state"],
    ]);
    off();
    expect(hub.viewers("cA")).toBe(0);
  });

  it("reconnects when Shelley drops the stream, and says so meanwhile", async () => {
    let connects = 0;
    hub.onConnected(() => connects++);
    hub.start();
    await shelley.waitForStreams(1);
    await eventually(() => expect(connects).toBe(1));
    shelley.dropStreams();
    await eventually(() => expect(connects).toBe(2));
    expect(hub.status().state).toBe("connected");
  });

  it("reports Shelley unreachable with the reason", async () => {
    await shelley.close();
    hub.start();
    await eventually(() => expect(hub.status().state).toBe("reconnecting"));
    expect(hub.status().error).toMatch(/unreachable/);
    shelley = await startFakeShelley(); // afterEach closes something
  });
});
