/**
 * @vitest-environment jsdom
 *
 * Where `/chats` lands on desktop: the last-opened bot when it still
 * exists, else the bot at the top of the sidebar (pinned first, then the
 * most recently active).
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { landingBotId, rememberLastBot } from "@/lib/last-bot";
import type { BotListEntry } from "@/lib/bots-api";

function bot(id: string, lastActivityAt: string, pinnedAt: string | null = null): BotListEntry {
  return { id, name: id, lastActivityAt, pinnedAt } as unknown as BotListEntry;
}

const quiet = bot("quiet", "2026-10-01T00:00:00Z");
const busy = bot("busy", "2026-10-20T00:00:00Z");
const pinned = bot("pinned", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");

beforeEach(() => localStorage.clear());

describe("landingBotId", () => {
  it("returns null with no bots", () => {
    expect(landingBotId([])).toBeNull();
  });

  it("falls back to the most recently active bot", () => {
    expect(landingBotId([quiet, busy])).toBe("busy");
  });

  it("prefers a pinned bot, matching the sidebar's first row", () => {
    expect(landingBotId([quiet, busy, pinned])).toBe("pinned");
  });

  it("returns the last-opened bot while it exists", () => {
    rememberLastBot("quiet");
    expect(landingBotId([quiet, busy, pinned])).toBe("quiet");
  });

  it("ignores a remembered bot that was deleted", () => {
    rememberLastBot("gone");
    expect(landingBotId([quiet, busy])).toBe("busy");
  });
});
