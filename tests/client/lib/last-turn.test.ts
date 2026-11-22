import { describe, expect, it } from "vite-plus/test";
import { lastTurn } from "@/lib/last-turn";
import type { ChatMessage } from "@/lib/chat-types";

const msg = (
  id: string,
  role: ChatMessage["role"],
  text: string,
  extra: Partial<ChatMessage> = {},
) => ({ id, role, text, status: "done", createdAt: 0, ...extra }) as ChatMessage;

describe("the last turn", () => {
  it("is the owner's latest message the server has saved", () => {
    expect(
      lastTurn([
        msg("e1", "user", "Find flights"),
        msg("e2", "assistant", "Echo: Find flights"),
        msg("e3", "user", "Make it December"),
        msg("e4", "assistant", "Echo: Make it December"),
      ]),
    ).toEqual({ at: "e3", text: "Make it December" });
  });

  it("skips another bot's message and one still being sent, and is nothing in an empty chat", () => {
    expect(
      lastTurn([
        msg("e1", "user", "Plan the week"),
        msg("e2", "user", "From Writer: draft ready", {
          peer: { kind: "message", name: "Writer" },
        }),
        msg("req-9", "user", "still sending"),
      ]),
    ).toEqual({ at: "e1", text: "Plan the week" });
    expect(lastTurn([])).toBeNull();
  });
});
