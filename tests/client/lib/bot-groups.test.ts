import { describe, expect, it } from "vite-plus/test";
import {
  groupBots,
  RECENT_FOLD_LIMIT,
  visibleRecent,
  previewLine,
  relativeTime,
} from "@/lib/bot-groups";
import type { BotListEntry } from "../../../apps/web/src/shared/api/bots";

function bot(id: string, overrides: Partial<BotListEntry> = {}): BotListEntry {
  return {
    id,
    conversationId: id,
    name: id,
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

describe("groupBots", () => {
  it("orders pinned bots by pin time and the rest by recent activity", () => {
    const { pinned, recent } = groupBots([
      bot("a", { lastActivityAt: "2026-01-01T00:00:00.000Z" }),
      bot("b", { lastActivityAt: "2026-01-03T00:00:00.000Z" }),
      bot("p2", { pinnedAt: "2026-01-02T00:00:00.000Z" }),
      bot("p1", {
        pinnedAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-02-01T00:00:00.000Z",
      }),
    ]);
    expect(pinned.map((b) => b.id)).toEqual(["p1", "p2"]);
    expect(recent.map((b) => b.id)).toEqual(["b", "a"]);
  });
});

describe("visibleRecent", () => {
  const many = Array.from({ length: RECENT_FOLD_LIMIT + 3 }, (_, i) => bot(`b${i}`));

  it("folds after the limit and shows everything when expanded", () => {
    expect(visibleRecent(many, false, null)).toHaveLength(RECENT_FOLD_LIMIT);
    expect(visibleRecent(many, true, null)).toHaveLength(many.length);
  });

  it("keeps the open bot visible even when it falls past the fold", () => {
    const shown = visibleRecent(many, false, "b10");
    expect(shown).toHaveLength(RECENT_FOLD_LIMIT + 1);
    expect(shown.at(-1)?.id).toBe("b10");
  });

  it("does not fold short lists", () => {
    expect(visibleRecent(many.slice(0, 3), false, null)).toHaveLength(3);
  });
});

describe("bot row helpers", () => {
  const now = new Date("2026-10-30T12:00:00").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("relativeTime reads like a messenger list", () => {
    expect(relativeTime(ago(20_000), now)).toBe("now");
    expect(relativeTime(ago(5 * 60_000), now)).toBe("5m");
    expect(relativeTime(ago(3 * 60 * 60_000), now)).toBe("3h");
    expect(relativeTime(ago(14 * 60 * 60_000), now)).toBe("Yesterday");
    expect(relativeTime("not a date", now)).toBe("");
  });

  it("previewLine flattens markdown and line breaks", () => {
    expect(previewLine("## Steps\n1. **Gather** `sources`\n\n> quote")).toBe(
      "Steps 1. Gather sources quote",
    );
  });

  it("previewLine keeps underscores inside names like update_instructions", () => {
    expect(previewLine("Ran update_instructions on _notes_ and my_file.py")).toBe(
      "Ran update_instructions on notes and my_file.py",
    );
    expect(previewLine("Calls foo__bar, _private and __bold__")).toBe(
      "Calls foo__bar, _private and bold",
    );
  });
});
