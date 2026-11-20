import { describe, expect, it } from "vite-plus/test";
import {
  finishedReplyTo,
  REPORT_ROUTINE_BLOCKED,
  type ChatMessage,
} from "../../../../packages/agent/src/index";

let seq = 0;
const user = (requestId: string | undefined, createdAt: number): ChatMessage => ({
  id: `e${++seq}`,
  role: "user",
  text: "hi",
  ...(requestId ? { requestId } : {}),
  status: "done",
  createdAt,
});
const assistant = (
  text: string,
  createdAt: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: `e${++seq}`,
  role: "assistant",
  text,
  status: "done",
  createdAt,
  ...extra,
});

const idle = (messages: ChatMessage[]) => ({ messages, busy: false, queued: [] });

describe("finishedReplyTo", () => {
  it("answers with the turn's last message, not a mid-turn one", () => {
    const messages = [
      user("r1", 1),
      assistant("Let me check…", 2, {
        toolCalls: [{ id: "c", name: "web_search", args: {}, status: "done" }],
      }),
      assistant("Here is the answer", 3),
    ];
    expect(finishedReplyTo(idle(messages), "r1")).toEqual({
      status: "answered",
      reply: { text: "Here is the answer", createdAt: 3 },
    });
  });

  it("never lets a queued second submission take the first one's reply", () => {
    const messages = [
      user("r1", 1),
      assistant("thinking out loud", 2),
      assistant("answer one", 3),
      user("r2", 4),
      assistant("answer two", 5),
    ];
    expect(finishedReplyTo(idle(messages), "r1")).toMatchObject({ reply: { text: "answer one" } });
    expect(finishedReplyTo(idle(messages), "r2")).toMatchObject({ reply: { text: "answer two" } });
  });

  it("collects refused tools and the newest blocked reason across the turn", () => {
    const messages = [
      user("run", 1),
      assistant("", 2, {
        toolCalls: [
          { id: "a", name: "send_email", args: {}, status: "error", approval: "refused" },
          { id: "b", name: REPORT_ROUTINE_BLOCKED, args: { reason: "no login" }, status: "done" },
        ],
      }),
      assistant("Couldn't finish", 3),
    ];
    expect(finishedReplyTo(idle(messages), "run")).toEqual({
      status: "answered",
      reply: {
        text: "Couldn't finish",
        createdAt: 3,
        refused: ["send_email"],
        blocked: "no login",
      },
    });
  });

  it("says when the turn hit a run limit, so callers need not guess", () => {
    const messages = [
      user("run", 1),
      assistant("", 2, {
        toolCalls: [{ id: "a", name: "web_fetch", args: {}, status: "error", limit: "runCap" }],
      }),
      assistant("Stopping here.", 3),
    ];
    expect(finishedReplyTo(idle(messages), "run")).toEqual({
      status: "answered",
      reply: { text: "Stopping here.", createdAt: 3, stoppedBy: "runCap" },
    });
  });

  it("collects what the turn sent the owner, in order (#396)", () => {
    const messages = [
      user("r1", 1),
      assistant("", 2, { sent: ["CI is green."] }),
      assistant("Told the owner about CI and the review.", 3, { sent: ["Bob approved."] }),
      user("r2", 4),
      assistant("unrelated", 5),
    ];
    expect(finishedReplyTo(idle(messages), "r1")).toEqual({
      status: "answered",
      reply: {
        text: "Told the owner about CI and the review.",
        createdAt: 3,
        sent: ["CI is green.", "Bob approved."],
      },
    });
  });

  it("carries a model error as the answer", () => {
    const messages = [user("r", 1), assistant("", 2, { status: "error", error: "Provider down" })];
    expect(finishedReplyTo(idle(messages), "r")).toEqual({
      status: "answered",
      reply: { text: "", createdAt: 2, error: "Provider down" },
    });
  });

  it("is pending until an assistant message follows, and unknown for another conversation's id", () => {
    expect(finishedReplyTo(idle([user("r", 1)]), "r")).toEqual({ status: "pending" });
    expect(finishedReplyTo(idle([user("r", 1)]), "other")).toEqual({ status: "unknown" });
  });

  it("is pending while the conversation is busy or the submission still queued", () => {
    const messages = [user("r", 1), assistant("partial", 2)];
    expect(finishedReplyTo({ messages, busy: true, queued: [] }, "r")).toEqual({
      status: "pending",
    });
    expect(
      finishedReplyTo(
        { messages: [], busy: false, queued: [{ requestId: "q", mode: "followUp", text: "hi" }] },
        "q",
      ),
    ).toEqual({ status: "pending" });
  });

  it("answers a turn that settled unanswered with empty text", () => {
    const silent = { ...user("r1", 1), status: "unanswered" as const, error: "No reply" };
    expect(finishedReplyTo(idle([silent, user("r2", 2)]), "r1")).toEqual({
      status: "answered",
      reply: { text: "", createdAt: 1 },
    });
  });

  it("gives every submission placed in one batch the batch's reply (#396)", () => {
    const messages = [
      user("r1", 1),
      user("r2", 2),
      assistant("answering both", 3),
      user("r3", 4),
      assistant("answer three", 5),
    ];
    expect(finishedReplyTo(idle(messages), "r1")).toEqual({
      status: "answered",
      reply: { text: "answering both", createdAt: 3 },
    });
    expect(finishedReplyTo(idle(messages), "r2")).toMatchObject({
      reply: { text: "answering both" },
    });
    expect(finishedReplyTo(idle(messages), "r3")).toMatchObject({
      reply: { text: "answer three" },
    });
  });
});
