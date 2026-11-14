/**
 * Characterization of behavior-register row U8: the memory watermark is per
 * bot, and it carries across New chat and continue.
 * Preserve: this pins today's behavior, quirk included; change it only with
 * a signed-off register row.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { captureConversation } from "../../../apps/web/src/server/api/bots/memories.runner";
import type { SideCaller, SideCallRequest } from "../../../apps/web/src/server/api/bots/side-call";
import { listPastChats } from "../../../apps/web/src/server/api/bots/chats.history";
import {
  continuePastChat,
  resetConversation,
} from "../../../apps/web/src/server/api/bots/chats.service";
import { bots, db } from "../../../apps/web/src/server/db";
import { installFakeRuntime, resetAppTables, seedBot } from "../fixtures";

const MINUTE = 60_000;

beforeEach(resetAppTables);
afterEach(resetAppTables);

const watermarkOf = async (id: string) =>
  (await db.query.bots.findFirst({ where: eq(bots.id, id) }))?.memoryCapturedThrough ?? null;

describe("U8: the memory watermark", () => {
  it("is the bot's, so turns of a chat continued after New chat fall behind it and are never captured", async () => {
    const fake = installFakeRuntime();
    const start = Date.now();
    const bot = await seedBot({ name: "Rememberer" });
    const chatA = bot.conversationId;

    // Chat A: the owner says something worth remembering; no capture runs yet.
    const transcripts = new Map<string, { role: string; text: string; createdAt: number }[]>();
    transcripts.set(chatA, [
      {
        role: "user",
        text: "I moved to Pune last month for a new job.",
        createdAt: start - 10 * MINUTE,
      },
      {
        role: "assistant",
        text: "Congratulations on the move!",
        createdAt: start - 10 * MINUTE + 1,
      },
    ]);
    fake.script.say(Number(chatA), "I moved to Pune last month.", "Congratulations!");
    expect(await watermarkOf(bot.id)).toBeNull();

    // New chat: the watermark is left as it was.
    await resetConversation(bot.id);
    const chatB = (await db.query.bots.findFirst({ where: eq(bots.id, bot.id) }))!.conversationId;
    expect(chatB).not.toBe(chatA);

    // Chat B: a capture runs and moves the bot's watermark to B's newest owner turn.
    vi.setSystemTime(start + 5 * MINUTE);
    transcripts.set(chatB, [
      {
        role: "user",
        text: "Please always answer me in British English.",
        createdAt: start + 5 * MINUTE,
      },
      { role: "assistant", text: "Will do.", createdAt: start + 5 * MINUTE + 1 },
    ]);
    const calls: SideCallRequest[] = [];
    const sideCaller: SideCaller = {
      complete: async (request) => {
        calls.push(request);
        return "[]";
      },
    };
    const deps = {
      sideCaller,
      readTranscript: async (id: number) => transcripts.get(String(id)) ?? [],
    };
    await captureConversation(Number(chatB), deps);
    expect(calls).toHaveLength(1);
    expect(await watermarkOf(bot.id)).toEqual(new Date(start + 5 * MINUTE));

    // Continue chat A: the watermark is still the one chat B set.
    vi.setSystemTime(start + 10 * MINUTE);
    const [pastA] = await listPastChats(bot.id);
    await continuePastChat(bot.id, pastA!.id);
    expect((await db.query.bots.findFirst({ where: eq(bots.id, bot.id) }))?.conversationId).toBe(
      chatA,
    );
    expect(await watermarkOf(bot.id)).toEqual(new Date(start + 5 * MINUTE));

    // A capture of chat A now: its owner turn is older than the watermark, so
    // nothing is read and no side-call is made. The Pune fact is never captured.
    await captureConversation(Number(chatA), deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain("British English");
    expect(calls[0]!.system).not.toContain("Pune");
    expect(await watermarkOf(bot.id)).toEqual(new Date(start + 5 * MINUTE));
  });
});
