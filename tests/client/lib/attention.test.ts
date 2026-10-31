import { describe, expect, it } from "vite-plus/test";
import type { BotListEntry } from "@/lib/bots-api";
import {
  attentionOf,
  BADGED_FAVICON,
  documentTitle,
  pageLabel,
  railBots,
  stateLabel,
  waitingCount,
  waitingLabel,
} from "@/lib/attention";

function bot(id: string, overrides: Partial<BotListEntry> = {}): BotListEntry {
  return {
    id,
    conversationId: id,
    name: `Bot ${id}`,
    description: "",
    modelId: "m",
    lastMessagePreview: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    lastReadAt: null,
    unread: false,
    replying: false,
    approvals: 0,
    questions: 0,
    pinnedAt: null,
    ...overrides,
  };
}

describe("attention", () => {
  const bots = [bot("a", { approvals: 1 }), bot("b", { questions: 2 }), bot("c")];

  it("reads a bot's attention once: waiting counts approvals and questions together", () => {
    expect(attentionOf(bot("a", { approvals: 1, questions: 2, replying: true }))).toEqual({
      waiting: 3,
      replying: true,
      unread: false,
    });
    expect(waitingLabel(bot("a", { approvals: 1, questions: 2 }))).toBe(
      "1 awaiting approval, 2 questions for you",
    );
    expect(stateLabel(bot("a", { questions: 1 }))).toBe("Bot a, 1 question for you");
    expect(stateLabel(bot("a", { replying: true }))).toBe("Bot a, replying");
    expect(stateLabel(bot("a", { unread: true }))).toBe("Bot a, unread");
    expect(stateLabel(bot("a"))).toBe("Bot a");
  });

  it("counts approvals and questions across bots", () => {
    expect(waitingCount(bots)).toBe(3);
    expect(waitingCount([bot("x")])).toBe(0);
  });

  it("titles the tab with what needs you, then where you are", () => {
    expect(documentTitle("/chats/c", bots)).toBe("(3) Bot c · tiny-agents");
    expect(documentTitle("/routines", [bot("x")])).toBe("Routines · tiny-agents");
    expect(documentTitle("/settings", [])).toBe("Settings · tiny-agents");
    expect(pageLabel("/vault/items/abc", [])).toBe("Vault");
    expect(documentTitle("/unknown", [])).toBe("tiny-agents");
  });

  it("keeps waiting bots first in the rail, then replying, unread, open, pinned", () => {
    const list = [
      bot("pinned", { pinnedAt: "2026-01-01T00:00:00.000Z" }),
      bot("quiet"),
      bot("unread", { unread: true }),
      bot("open"),
      bot("waiting", { approvals: 1 }),
      bot("replying", { replying: true }),
    ];
    expect(railBots(list, "open").shown.map((b) => b.id)).toEqual([
      "waiting",
      "replying",
      "unread",
      "open",
      "pinned",
    ]);
  });

  it("counts waiting bots that do not fit in the rail", () => {
    const many = Array.from({ length: 10 }, (_, i) => bot(`w${i}`, { questions: 1 }));
    const { shown, hiddenWaiting } = railBots(many, null, 8);
    expect(shown).toHaveLength(8);
    expect(hiddenWaiting).toBe(2);
  });

  it("badges the favicon without loading other files", () => {
    expect(BADGED_FAVICON.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(BADGED_FAVICON)).toContain("<circle");
  });
});
