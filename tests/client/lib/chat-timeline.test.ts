/**
 * Routine run cards (issue #63) merge into the chat timeline by when the run
 * finished; messages keep their order and their index, and runs that finish
 * back to back fold into one quiet line.
 */
import { describe, expect, it } from "vite-plus/test";
import { chatTimeline } from "../../../apps/web/src/client/lib/chat-timeline";
import type { ChatMessage, RoutineRunCard } from "../../../apps/web/src/client/lib/chat-types";

const DAY = 86_400_000;
const BASE = Date.parse("2026-10-20T06:00:00.000Z");

const message = (id: string, createdAt: number): ChatMessage => ({
  id,
  role: "assistant",
  text: id,
  status: "done",
  createdAt: BASE + createdAt,
});

const card = (id: string, finishedAt: number): RoutineRunCard => ({
  id,
  routineId: "r",
  routineName: "digest",
  status: "succeeded",
  trigger: "schedule",
  scheduledFor: new Date(BASE + finishedAt).toISOString(),
  finishedAt: new Date(BASE + finishedAt).toISOString(),
  output: "ok",
  error: null,
});

const shape = (items: ReturnType<typeof chatTimeline>) =>
  items.map((item) =>
    item.kind === "message"
      ? `${item.message.id}#${item.index}`
      : item.kind === "routine-runs"
        ? `runs:${item.runs.map((run) => run.id).join("+")}`
        : `echo:${item.echo.requestId}`,
  );

describe("chatTimeline", () => {
  it("slots runs between messages by finish time, oldest first", () => {
    const items = chatTimeline(
      [message("m1", 1_000), message("m2", 3_000), message("m3", 5_000)],
      [card("late", 6_000), card("between", 4_000), card("first", 500)],
    );
    expect(shape(items)).toEqual([
      "runs:first",
      "m1#0",
      "m2#1",
      "runs:between",
      "m3#2",
      "runs:late",
    ]);
  });

  it("folds runs that finish back to back into one line, newest time last", () => {
    const items = chatTimeline(
      [message("m1", 1_000), message("m2", 10_000)],
      [card("a", 2_000), card("b", 3_000), card("c", 4_000), card("after", 11_000)],
    );
    expect(shape(items)).toEqual(["m1#0", "runs:a+b+c", "m2#1", "runs:after"]);
    expect(items[1].at).toBe(BASE + 4_000);
  });

  it("starts a new line on a new day", () => {
    expect(shape(chatTimeline([], [card("today", 0), card("tomorrow", DAY)]))).toEqual([
      "runs:today",
      "runs:tomorrow",
    ]);
  });

  it("hides a shared chat's [skip] replies, also while they stream (issue #145)", () => {
    const skip = { ...message("skip", 2_000), text: "[skip]" };
    const streaming = { ...message("sk", 3_000), text: "[sk", status: "streaming" as const };
    const real = { ...message("real", 4_000), text: "[skipping] is a word" };
    expect(shape(chatTimeline([message("m1", 1_000), skip, streaming, real], []))).toEqual([
      "m1#0",
      "real#3",
    ]);
  });

  it("shows only what a quiet turn sent, its own words folded into its thinking (#396)", () => {
    const quiet: ChatMessage = {
      ...message("q", 1),
      text: "The hand-off finished; the owner should hear the PR is up.",
      quiet: true,
      sent: ["PR #12 is up for review."],
    };
    const silent: ChatMessage = { ...message("s", 2), text: "Nothing worth sending.", quiet: true };
    const skipped: ChatMessage = { ...message("k", 3), text: "[skip]", quiet: true };
    const items = chatTimeline([quiet, silent, skipped], []);
    const shown = items.map((item) => (item.kind === "message" ? item.message : undefined));
    expect(shown.map((m) => [m?.text, m?.reasoning])).toEqual([
      ["PR #12 is up for review.", "The hand-off finished; the owner should hear the PR is up."],
      ["", "Nothing worth sending."],
    ]);
  });

  it("folds a run of tool-only rounds into the reply that follows", () => {
    const round = (id: string, at: number): ChatMessage => ({
      ...message(id, at),
      text: "",
      toolCalls: [{ id: `${id}-call`, name: "browser_snapshot", args: {}, status: "done" }],
    });
    const user: ChatMessage = { ...message("u", 0), role: "user", text: "read it" };
    const items = chatTimeline([user, round("r1", 1), round("r2", 2), message("reply", 3)], []);
    expect(shape(items)).toEqual(["u#0", "r1#3"]);
    const folded = items[1];
    if (folded.kind !== "message") throw new Error("expected a message");
    expect(folded.ids).toEqual(["r1", "r2", "reply"]);
    expect(folded.message.text).toBe("reply");
    expect(folded.message.toolCalls?.map((call) => call.id)).toEqual(["r1-call", "r2-call"]);
  });

  it("leaves a round with text, or one still streaming, as its own row", () => {
    const streaming: ChatMessage = {
      ...message("s", 1),
      text: "",
      status: "streaming",
      toolCalls: [{ id: "c", name: "browser_snapshot", args: {}, status: "running" }],
    };
    expect(shape(chatTimeline([message("a", 0), streaming, message("b", 2)], []))).toEqual([
      "a#0",
      "s#1",
      "b#2",
    ]);
  });
});
