/**
 * Routine run cards (issue #63) merge into the chat timeline by when the run
 * finished; messages keep their order and their index.
 */
import { describe, expect, it } from "vite-plus/test";
import { chatTimeline } from "../../../apps/web/src/client/lib/chat-timeline";
import type { ChatMessage, RoutineRunCard } from "../../../apps/web/src/client/lib/chat-types";

const message = (id: string, createdAt: number): ChatMessage => ({
  id,
  role: "assistant",
  text: id,
  status: "done",
  createdAt,
});

const card = (id: string, finishedAt: number): RoutineRunCard => ({
  id,
  routineId: "r",
  routineName: "digest",
  status: "succeeded",
  trigger: "schedule",
  scheduledFor: new Date(finishedAt).toISOString(),
  finishedAt: new Date(finishedAt).toISOString(),
  output: "ok",
  error: null,
});

const shape = (items: ReturnType<typeof chatTimeline>) =>
  items.map((item) =>
    item.kind === "message" ? `${item.message.id}#${item.index}` : `card:${item.run.id}`,
  );

describe("chatTimeline", () => {
  it("slots cards between messages by finish time, oldest first", () => {
    const items = chatTimeline(
      [message("m1", 1_000), message("m2", 3_000), message("m3", 5_000)],
      [card("late", 6_000), card("between", 4_000), card("first", 500)],
    );
    expect(shape(items)).toEqual([
      "card:first",
      "m1#0",
      "m2#1",
      "card:between",
      "m3#2",
      "card:late",
    ]);
    expect(items.map((item) => item.at)).toEqual([500, 1_000, 3_000, 4_000, 5_000, 6_000]);
  });

  it("shows cards alone when the chat has no messages", () => {
    expect(shape(chatTimeline([], [card("only", 1_000)]))).toEqual(["card:only"]);
  });
});
