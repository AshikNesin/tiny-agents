/**
 * Characterization of behavior-register row U14: deleting a bot or a past
 * chat leaves its conversations orphaned in `agent.db`.
 * Preserve: this pins today's behavior, quirk included; change it only with
 * a signed-off register row.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { AgentRuntime } from "../../../packages/agent/src/runtime";
import { deletePastChat, listPastChats } from "../../../apps/web/src/server/api/bots/chats.history";
import { deleteBot } from "../../../apps/web/src/server/api/bots/bots.service";
import { resetConversation } from "../../../apps/web/src/server/api/bots/chats.service";
import { botChats, bots, db } from "../../../apps/web/src/server/db";
import { closeAppRuntime, openAppRuntime, resetAppTables, seedBot, until } from "../fixtures";

let runtime: AgentRuntime;

beforeEach(async () => {
  await resetAppTables();
  runtime = await openAppRuntime();
});
afterEach(async () => {
  await closeAppRuntime();
  await resetAppTables();
});

async function chatWith(conversationId: string, text: string): Promise<string[]> {
  const ref = Number(conversationId);
  await runtime.submit(ref, { requestId: `u14-${text}`, text });
  return until(async () => {
    const state = await runtime.readChat(ref);
    return !state.busy && state.messages.at(-1)?.text === `Echo: ${text}`
      ? state.messages.map((m) => m.text)
      : undefined;
  }, `the reply to ${text}`);
}

describe("U14: deletes leave the durable conversations behind", () => {
  it("a deleted bot's chat is still in the runtime, transcript and all", async () => {
    const bot = await seedBot({ name: "Doomed" });
    const transcript = await chatWith(bot.conversationId, "remember me");

    await deleteBot(bot.id);
    expect(await db.query.bots.findFirst({ where: eq(bots.id, bot.id) })).toBeUndefined();

    const orphan = await runtime.readChat(Number(bot.conversationId));
    expect(orphan.messages.map((m) => m.text)).toEqual(transcript);
    expect(transcript).toEqual(["remember me", "Echo: remember me"]);
  });

  it("a deleted past chat's conversation is still in the runtime", async () => {
    const bot = await seedBot({ name: "Keeper" });
    const old = bot.conversationId;
    const transcript = await chatWith(old, "first chat");

    await resetConversation(bot.id);
    const [past] = await listPastChats(bot.id);
    expect(past).toBeDefined();
    await deletePastChat(bot.id, past!.id);
    expect(await db.query.botChats.findFirst({ where: eq(botChats.id, past!.id) })).toBeUndefined();

    const orphan = await runtime.readChat(Number(old));
    expect(orphan.messages.map((m) => m.text)).toEqual(transcript);
  });
});
