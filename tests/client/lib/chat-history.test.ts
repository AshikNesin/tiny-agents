import { describe, expect, it } from "vite-plus/test";
import type { ChatMessage } from "@/lib/chat-types";
import { mergeSnapshot, oldestEntryId, prependOlder } from "@/lib/chat-history";

const msg = (n: number): ChatMessage => ({
  id: `e${n}`,
  role: n % 2 ? "user" : "assistant",
  text: `m${n}`,
  status: "done",
  createdAt: n,
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));

describe("chat history paging", () => {
  it("prepends an older page without duplicates", () => {
    const merged = prependOlder(range(50, 60), { messages: range(40, 50), hasMore: true });
    expect(merged.messages.map((m) => m.id)).toEqual(range(40, 60).map((m) => m.id));
    expect(merged.hasMore).toBe(true);
  });

  it("keeps loaded older pages when a reconnect snapshot arrives", () => {
    const previous = { messages: range(10, 70), hasMore: false };
    const merged = mergeSnapshot(previous, { messages: range(30, 75), hasMore: true });
    expect(merged.messages.map((m) => m.id)).toEqual(range(10, 75).map((m) => m.id));
    expect(merged.hasMore).toBe(false);
  });

  it("lets a snapshot that starts at the beginning replace everything (a new chat)", () => {
    const previous = { messages: range(10, 70), hasMore: true };
    const merged = mergeSnapshot(previous, { messages: range(1, 3), hasMore: false });
    expect(merged.messages.map((m) => m.id)).toEqual(["e1", "e2", "e3"]);
    expect(merged.hasMore).toBe(false);
  });

  it("pages back from the oldest transcript entry, skipping markers", () => {
    const marker: ChatMessage = { ...msg(1), id: "live" };
    expect(oldestEntryId([marker, msg(5), msg(6)])).toBe("e5");
  });
});
