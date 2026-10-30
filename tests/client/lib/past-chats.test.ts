import { describe, expect, it } from "vite-plus/test";
import { messageCountLabel, pastChatRange, pastChatTitle } from "@/lib/past-chats";

const now = new Date(2026, 9, 30, 12).getTime();
const at = (month: number, day: number, year = 2026) =>
  new Date(year, month, day, 10).toISOString();

describe("past chats (issue #101)", () => {
  it("falls back to the start date when a chat has no title", () => {
    expect(pastChatTitle({ title: "Goa trip", startedAt: at(9, 12) }, now)).toBe("Goa trip");
    expect(pastChatTitle({ title: null, startedAt: at(9, 12) }, now)).toMatch(/^Chat from .*12/);
  });

  it("shows one day for a same-day chat, a range otherwise, and the year only when it differs", () => {
    const sameDay = pastChatRange({ startedAt: at(9, 12), endedAt: at(9, 12) }, now);
    expect(sameDay).not.toContain("–");
    expect(pastChatRange({ startedAt: at(9, 12), endedAt: at(9, 20) }, now)).toContain(" – ");
    expect(pastChatRange({ startedAt: at(11, 30, 2025), endedAt: at(0, 2) }, now)).toContain(
      "2025",
    );
  });

  it("counts messages", () => {
    expect(messageCountLabel(1)).toBe("1 message");
    expect(messageCountLabel(34)).toBe("34 messages");
  });
});
