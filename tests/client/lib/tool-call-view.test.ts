import { describe, expect, it } from "vite-plus/test";
import {
  isActive,
  viewOf,
  type ToolCallView,
} from "../../../apps/web/src/client/lib/tool-call-view";
import type { ChatToolCall, ChatToolStatus } from "../../../apps/web/src/client/lib/chat-types";

const call = (status: ChatToolStatus, extra: Partial<ChatToolCall> = {}): ChatToolCall => ({
  id: "t1",
  name: "delete_task",
  args: {},
  status,
  taskId: 7,
  ...extra,
});

const questions = [{ question: "Which one?" }];
const vault: ChatToolCall["vault"] = {
  handle: "github",
  label: "GitHub",
  kind: "login",
  tool: "browser_fill",
  target: "https://github.com",
  grantable: true,
};
const credentials: ChatToolCall["credentials"] = {
  status: "pending",
  origin: "https://example.com",
  title: "Example",
  purpose: "sign in",
  fields: [],
};
const takeover = { status: "pending" as const, reason: "Solve the captcha" };
const code = { threadId: "shelley:1", harness: "shelley", title: null, cwd: null, url: "/code/1" };

describe("viewOf: plain trace lines by status", () => {
  const rows: [ChatToolStatus, Omit<ToolCallView, "foldable">, boolean][] = [
    ["pending", { phase: "pending", trace: "running" }, false],
    ["running", { phase: "running", trace: "running" }, false],
    ["done", { phase: "done" }, true],
    ["error", { phase: "failed", trace: "error" }, true],
    ["denied", { phase: "failed", trace: "error", icon: "ban", note: "denied by you" }, true],
    [
      "expired",
      { phase: "failed", trace: "error", icon: "ban", note: "nobody answered in time" },
      true,
    ],
    ["aborted", { phase: "failed", trace: "error", icon: "ban", note: "stopped" }, true],
    [
      "interrupted",
      { phase: "failed", trace: "error", icon: "ban", note: "interrupted by a restart" },
      true,
    ],
  ];
  it.each(rows)("%s", (status, view, foldable) => {
    expect(viewOf(call(status))).toEqual({ ...view, foldable });
  });

  it("counts pending, running and waiting calls as the bot visibly at work", () => {
    const active = (status: ChatToolStatus) => isActive(call(status));
    const working = ["pending", "running", "awaiting_approval", "awaiting_takeover"] as const;
    expect(working.map(active)).toEqual([true, true, true, true]);
    expect((["done", "error", "denied"] as const).map(active)).toEqual([false, false, false]);
  });
});

describe("viewOf: Owner waits", () => {
  const waiting = { phase: "waiting", trace: "pending", icon: "clock", foldable: false } as const;
  const rows: [string, ChatToolCall, Partial<ToolCallView>][] = [
    [
      "an approval",
      call("awaiting_approval"),
      { waitingOn: "approval", card: "approval", anchor: "approval:7" },
    ],
    [
      "a vault use",
      call("awaiting_approval", { vault }),
      { waitingOn: "approval", card: "vault-approval", anchor: "approval:7" },
    ],
    [
      "an approval with no task id yet",
      call("awaiting_approval", { taskId: undefined }),
      { waitingOn: "approval" },
    ],
    [
      "Questions",
      call("awaiting_answer", { name: "ask_owner", questions }),
      { waitingOn: "answer", card: "question", anchor: "question:7" },
    ],
    [
      "a credential request",
      call("awaiting_credentials", { credentials }),
      { waitingOn: "credentials", card: "credentials", anchor: "credentials:7" },
    ],
    [
      "a credential request without its form",
      call("awaiting_credentials"),
      { waitingOn: "credentials" },
    ],
    [
      "a takeover",
      call("awaiting_takeover", { takeover }),
      { waitingOn: "takeover", card: "takeover", anchor: "takeover:7" },
    ],
    [
      "a takeover with no task id",
      call("awaiting_takeover", { takeover, taskId: undefined }),
      { waitingOn: "takeover", card: "takeover" },
    ],
  ];
  const notes: Record<string, string> = {
    approval: "waiting for your approval",
    answer: "waiting for your answers",
    credentials: "waiting for you to sign in",
    takeover: "waiting for you on the computer",
  };

  it.each(rows)("%s gets its card", (_name, input, expected) => {
    expect(viewOf(input)).toEqual({ ...waiting, note: notes[expected.waitingOn!], ...expected });
  });

  it.each(rows)("%s in a Past chat: no card, not answered", (_name, input, expected) => {
    const view = viewOf(input, { readOnly: true });
    expect(view).toMatchObject({ ...waiting, waitingOn: expected.waitingOn, note: "not answered" });
    expect(view.anchor).toBeUndefined();
    expect(view.card).toBe(input.questions ? "asked-questions" : undefined);
  });
});

describe("viewOf: cards of their own", () => {
  it("shows asked questions with how they ended", () => {
    const asked = (status: ChatToolStatus, extra: Partial<ChatToolCall> = {}) =>
      viewOf(call(status, { name: "ask_owner", questions, ...extra }));
    expect(asked("done", { answers: [{ selected: ["A"] }] })).toEqual({
      phase: "done",
      card: "asked-questions",
      foldable: false,
    });
    expect(asked("done").note).toBe("dismissed by you");
    expect(asked("aborted").note).toBe("stopped");
  });

  it("draws hand-offs as their cards, never folded", () => {
    expect(viewOf(call("done", { name: "message_bot" }))).toMatchObject({
      card: "bot-handoff",
      foldable: false,
    });
    expect(viewOf(call("error", { name: "message_bot" }))).toMatchObject({
      phase: "failed",
      card: "bot-handoff",
      foldable: false,
    });
    expect(viewOf(call("done", { name: "code_start", code }))).toMatchObject({
      card: "code-handoff",
      foldable: false,
    });
  });
});
