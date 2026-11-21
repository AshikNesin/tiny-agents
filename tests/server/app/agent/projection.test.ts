import type { EntryRecord, LiveState } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vite-plus/test";
import { ChatProjection, unansweredOf } from "../../../../packages/agent/src/projection";
import type { ChatEvent } from "../../../../packages/agent/src/index";

const user = (id: number, text: string): EntryRecord =>
  ({
    id,
    kind: "pi.user",
    model: [{ role: "user", content: text, timestamp: id }],
  }) as unknown as EntryRecord;

const assistant = (id: number, text: string, stopReason = "stop"): EntryRecord =>
  ({
    id,
    kind: "pi.assistant",
    model: [
      {
        role: "assistant",
        content: [{ type: "text", text }],
        stopReason,
        timestamp: id,
        model: "m",
      },
    ],
  }) as unknown as EntryRecord;

const liveMessage = (text = "") =>
  ({ role: "assistant", content: [{ type: "text", text }], model: "m", timestamp: 9 }) as never;

const live = (state: unknown) => state as LiveState;
const run = { taskId: 3, inputs: [1], first: 1, turns: 0 };

function reduce(state: ReturnType<ChatProjection["full"]>, events: ChatEvent[]) {
  let next = structuredClone(state);
  for (const event of events) {
    if (event.type === "snapshot") next = structuredClone(event.state);
    else if (event.type === "upsert") {
      const i = next.messages.findIndex((m) => m.id === event.message.id);
      if (i >= 0) next.messages[i] = event.message;
      else next.messages.push(event.message);
    } else if (event.type === "delta") {
      const m = next.messages.find((m) => m.id === event.id)!;
      m.text += event.text ?? "";
    } else if (event.type === "remove") {
      next.messages = next.messages.filter((m) => m.id !== event.id);
    } else if (event.type === "busy") next.busy = event.busy;
  }
  return next;
}

describe("ChatProjection", () => {
  it("streams a reply as deltas and lands it as an entry", () => {
    const projection = new ChatProjection({ entries: [user(1, "hi")], busy: true, tools: [] });
    expect(projection.state.messages.map((m) => [m.text, m.status])).toEqual([["hi", "done"]]);

    projection.observe([], live({ run, generation: { attempt: 1, message: liveMessage() } }));
    let shown = projection.state;
    let events = projection.flush();
    expect(events.map((e) => e.type)).toEqual(["upsert"]);
    shown = reduce(shown, events);
    expect(shown.messages.at(-1)).toMatchObject({ id: "live", status: "streaming" });

    projection.observe(
      [],
      live({ run, generation: { attempt: 1, message: liveMessage("Hello") } }),
    );
    events = projection.flush();
    expect(events).toEqual([{ type: "delta", id: "live", text: "Hello" }]);
    shown = reduce(shown, events);

    projection.observe([assistant(2, "Hello")], live({}));
    events = projection.flush();
    expect(events.map((e) => e.type).sort()).toEqual(["busy", "remove", "upsert"]);
    shown = reduce(shown, events);
    expect(shown.busy).toBe(false);
    expect(shown.messages.map((m) => [m.id, m.text, m.status])).toEqual([
      ["e1", "hi", "done"],
      ["e2", "Hello", "done"],
    ]);
  });

  it("keeps a window's start fixed as entries arrive", () => {
    const entries = [user(1, "a"), assistant(2, "b"), user(3, "c"), assistant(4, "d")];
    const projection = new ChatProjection({ entries, busy: false, tools: [] }, { window: 2 });
    expect(projection.state).toMatchObject({ hasMore: true, cursor: "e3" });
    expect(projection.state.messages.map((m) => m.id)).toEqual(["e3", "e4"]);

    projection.observe([user(5, "e")], live({}));
    const events = projection.flush();
    expect(events).toEqual([{ type: "upsert", message: expect.objectContaining({ id: "e5" }) }]);
    expect(projection.state.messages.map((m) => m.id)).toEqual(["e3", "e4", "e5"]);
  });

  it("flags an unanswered input once its run fails and on a fresh projection", () => {
    const projection = new ChatProjection({ entries: [user(1, "hi")], busy: false, tools: [] });
    projection.markUnanswered(new Map([[1, "no_model"]]));
    const [upsert] = projection.flush();
    expect(upsert).toMatchObject({
      type: "upsert",
      message: { id: "e1", status: "unanswered", error: expect.stringMatching(/model/) },
    });

    const records = [
      { type: "input", status: "unanswered", entry: 1, reason: "no_model" },
      { type: "input", status: "done", entry: 2 },
      { type: "write", status: "unanswered", entry: 3, reason: "x" },
    ] as never[];
    expect(unansweredOf(records)).toEqual(new Map([[1, "no_model"]]));
    const again = new ChatProjection({
      entries: [user(1, "hi")],
      busy: false,
      tools: [],
      unanswered: unansweredOf(records),
    });
    expect(again.state.messages[0]).toMatchObject({ status: "unanswered" });
  });

  it("explains in words why a run ended without an answer", () => {
    const projection = new ChatProjection({
      entries: [user(1, "a"), user(2, "b")],
      busy: false,
      tools: [],
    });
    projection.markUnanswered(
      new Map([
        [1, "interrupted"],
        [2, "restart_limit"],
      ]),
    );
    projection.flush();
    expect(projection.state.messages.map((m) => m.error)).toEqual([
      "The app restarted while the model was answering. Send it again.",
      "This kept failing after restarts, so it was stopped. Send it again.",
    ]);
  });

  it("a tool round: start, details, end", () => {
    const call = {
      role: "assistant",
      content: [{ type: "toolCall", id: "c1", name: "send_email", arguments: { to: "a" } }],
      stopReason: "toolUse",
      model: "m",
      timestamp: 2,
    };
    const projection = new ChatProjection({
      entries: [user(1, "mail a"), { id: 2, kind: "pi.assistant", model: [call] } as never],
      busy: true,
      tools: [],
    });
    projection.observe(
      [],
      live({
        run,
        tools: [{ callId: "c1", toolName: "send_email", status: "running", taskId: 7 }],
      }),
    );
    projection.flush();
    expect(projection.state.messages[1].toolCalls?.[0]).toMatchObject({
      status: "running",
      taskId: 7,
    });
    projection.observe(
      [],
      live({
        run,
        tools: [
          {
            callId: "c1",
            toolName: "send_email",
            status: "running",
            taskId: 7,
            details: { approval: "pending" },
          },
        ],
      }),
    );
    projection.flush();
    expect(projection.state.messages[1].toolCalls?.[0].status).toBe("awaiting_approval");
    projection.observe([], live({}));
    projection.flush();
    expect(projection.state.busy).toBe(false);
  });
});
