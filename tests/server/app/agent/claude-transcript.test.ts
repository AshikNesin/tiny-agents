/**
 * The Claude plan transcript's projection (ADR 0018): `claude.*` records
 * in entry order, plus the running turn and the queue, become the chat.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  claudeMessages,
  claudeRecordOf,
  replyEntry,
  userEntry,
  withdrawnEntry,
  type ClaudeRecord,
} from "../../../../packages/agent/src/engines/claude-code/transcript";

const user = (requestId: string, text: string) =>
  claudeRecordOf(userEntry({ requestId, text, createdAt: 1 }))!;
const reply = (turnId: string, text: string, status: "streaming" | "done" | "stopped") =>
  claudeRecordOf(
    replyEntry({
      turnId,
      text,
      status,
      createdAt: 2,
      toolCalls: [{ id: "toolu_1", name: "send_email", args: {}, status: "running" }],
    }),
  )!;

describe("the Claude plan transcript", () => {
  it("orders each turn after its own message, whatever order the entries landed in", () => {
    const records: ClaudeRecord[] = [
      user("r1", "one"),
      user("r2", "two"),
      reply("r1", "first", "done"),
      reply("r2", "second", "done"),
    ];
    expect(claudeMessages(records, { queued: new Set() }).map((m) => m.id)).toEqual([
      "u-r1",
      "a-r1",
      "u-r2",
      "a-r2",
    ]);
  });

  it("keeps the newest reply of a turn", () => {
    const records = [
      user("r1", "one"),
      reply("r1", "so far", "streaming"),
      reply("r1", "all", "done"),
    ];
    expect(claudeMessages(records, { queued: new Set() }).at(-1)).toMatchObject({
      text: "all",
      status: "done",
    });
  });

  it("shows a reply a restart cut off mid-turn as an error, its open call interrupted", () => {
    const records = [user("r1", "one"), reply("r1", "half", "streaming")];
    const [, cut] = claudeMessages(records, { queued: new Set() });
    expect(cut).toMatchObject({ id: "a-r1", text: "half", status: "error" });
    expect(cut?.error).toMatch(/app restarted/);
    expect(cut?.toolCalls).toEqual([
      { id: "toolu_1", name: "send_email", args: {}, status: "interrupted" },
    ]);
  });

  it("leaves out queued and withdrawn messages", () => {
    const records = [
      user("r1", "one"),
      user("r2", "two"),
      user("r3", "three"),
      claudeRecordOf(withdrawnEntry(["r3"]))!,
    ];
    const live = { reply: { turnId: "r1", text: "", status: "streaming" as const, createdAt: 3 } };
    expect(claudeMessages(records, { ...live, queued: new Set(["r2"]) }).map((m) => m.id)).toEqual([
      "u-r1",
    ]);
  });

  it("refuses an entry that does not fit its shape", () => {
    expect(() => claudeRecordOf({ kind: "claude.user", data: { text: 1 } })).toThrow(
      /does not fit its shape/,
    );
    expect(claudeRecordOf({ kind: "chat.user", data: {} })).toBeUndefined();
  });
});
