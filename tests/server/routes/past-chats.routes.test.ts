import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, createTestApp } from "../helpers";
import { db, botChats } from "../../../apps/web/src/server/db";
import { setChatTitler } from "../../../apps/web/src/server/api/bots/chats.title";
import { CHAT_WINDOW } from "../../../packages/agent/src/transcript";
import type { AgentRuntime } from "../../../packages/agent/src/index";
import {
  authToken,
  closeAppRuntime,
  openAppRuntime,
  resetAppTables,
  spyOnRuntime,
  TEST_MODEL,
  until,
  type SpiedRuntime,
} from "../fixtures";

/**
 * Past chats (issue #101): "New chat" records the chat it leaves, which the
 * owner can list, read (paged like the live chat), continue or delete. Runs
 * on the real runtime: the owner's messages go through the API and the faux
 * model answers each with "Echo: <text>".
 */

const token = await authToken("past-chats-test@example.com");

type Msg = { id: string; role: string; text: string };

const app = createTestApp();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data varies per route
type Data = any;

/** An authenticated JSON request through the app. */
function call(path: string, init: { method?: string; json?: unknown } = {}) {
  return api<Data>(app, path, { ...init, token });
}

let rt: AgentRuntime;
let runtime: SpiedRuntime;

async function createBot(name = "Travel"): Promise<{ id: string; conversationId: string }> {
  const response = await call("/api/v1/bots", {
    method: "POST",
    json: { name, systemPrompt: "Plan trips.", modelId: TEST_MODEL },
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; conversationId: string };
}

/** The bot's current conversation, as the row names it. */
async function chatOf(botId: string): Promise<number> {
  const response = await call(`/api/v1/bots/${botId}`);
  return Number(response.body.data.conversationId);
}

/** Send each owner message and wait for its reply, so the transcript holds owner, bot, owner, bot… */
async function converse(botId: string, ...texts: string[]): Promise<void> {
  const conversation = await chatOf(botId);
  for (const [i, text] of texts.entries()) {
    const sent = await call(`/api/v1/bots/${botId}/messages`, {
      method: "POST",
      json: { requestId: `say-${conversation}-turn-${i}`, text },
    });
    expect(sent.status).toBe(200);
    await until(
      async () => {
        const state = await rt.readChat(conversation);
        return !state.busy && state.messages.length === 2 * (i + 1);
      },
      `reply ${i + 1} in conversation ${conversation}`,
    );
  }
}

async function newChat(botId: string): Promise<{ conversationId: string }> {
  const response = await call(`/api/v1/bots/${botId}/reset`, { method: "POST" });
  expect(response.status).toBe(200);
  return response.body.data as { conversationId: string };
}

async function listChats(botId: string) {
  const response = await call(`/api/v1/bots/${botId}/chats`);
  expect(response.status).toBe(200);
  return response.body.data.chats as Array<Record<string, unknown>>;
}

describe("Past chats", () => {
  beforeEach(async () => {
    rt = await openAppRuntime();
    runtime = spyOnRuntime(rt);
    setChatTitler(undefined);
    await resetAppTables();
  });

  afterEach(async () => {
    setChatTitler(undefined);
    await resetAppTables();
    await closeAppRuntime();
  });

  it("records the chat New chat leaves, titled by its first owner message", async () => {
    const bot = await createBot();
    await converse(bot.id, "  Find   flights to Goa\nin December");

    await newChat(bot.id);

    const chats = await listChats(bot.id);
    expect(chats).toEqual([
      expect.objectContaining({
        title: "Find flights to Goa in December",
        messageCount: 2,
      }),
    ]);
    // The conversation id stays server-side.
    expect(chats[0]).not.toHaveProperty("conversationId");
    const row = await db.query.botChats.findFirst({ where: eq(botChats.botId, bot.id) });
    expect(row?.conversationId).toBe(bot.conversationId);
  });

  it("records nothing for an empty chat", async () => {
    const bot = await createBot();
    await newChat(bot.id);
    expect(await listChats(bot.id)).toEqual([]);
  });

  it("lists the most recently ended chat first", async () => {
    const bot = await createBot();
    await converse(bot.id, "First topic");
    await newChat(bot.id);
    await converse(bot.id, "Second topic");
    await newChat(bot.id);
    expect((await listChats(bot.id)).map((chat) => chat.title)).toEqual([
      "Second topic",
      "First topic",
    ]);
  });

  it("404s for an unknown bot and for another bot's chat", async () => {
    const travel = await createBot("Travel");
    const other = await createBot("Other");
    await converse(travel.id, "Trip");
    await newChat(travel.id);
    const [chat] = await listChats(travel.id);

    expect((await call("/api/v1/bots/no-such-bot/chats")).status).toBe(404);
    expect((await call(`/api/v1/bots/${other.id}/chats/${chat.id}`)).status).toBe(404);
    expect(
      (await call(`/api/v1/bots/${other.id}/chats/${chat.id}`, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("reads the newest window and pages older messages", async () => {
    const bot = await createBot();
    // Enough owner messages that owner + reply pairs overflow the window.
    const owner = Array.from({ length: Math.ceil(CHAT_WINDOW / 2) + 3 }, (_, i) => `turn ${i + 1}`);
    await converse(bot.id, ...owner);
    const all = owner.flatMap((text) => [text, `Echo: ${text}`]);
    await newChat(bot.id);
    const [chat] = await listChats(bot.id);

    const read = await call(`/api/v1/bots/${bot.id}/chats/${chat.id}`);
    expect(read.status).toBe(200);
    const view = read.body.data as {
      chat: { id: string };
      state: { messages: Msg[]; hasMore: boolean; cursor: string };
      runs: unknown[];
    };
    expect(view.chat.id).toBe(chat.id);
    expect(view.state.messages).toHaveLength(CHAT_WINDOW);
    expect(view.state.messages.map((m) => m.text)).toEqual(all.slice(all.length - CHAT_WINDOW));
    expect(view.state.hasMore).toBe(true);
    expect(view.runs).toEqual([]);

    const query = new URLSearchParams({ before: view.state.cursor, limit: "50" });
    const page = await call(`/api/v1/bots/${bot.id}/chats/${chat.id}/messages?${query}`);
    expect(page.status).toBe(200);
    expect(page.body.data).toMatchObject({ hasMore: false });
    expect((page.body.data.messages as Msg[]).map((m) => m.text)).toEqual(
      all.slice(0, all.length - CHAT_WINDOW),
    );
  });

  it("continues a past chat: the bot moves back, and the chat it left becomes a past chat", async () => {
    const bot = await createBot();
    const first = Number(bot.conversationId);
    await converse(bot.id, "Old trip");
    const second = Number((await newChat(bot.id)).conversationId);
    await converse(bot.id, "Current topic");
    const [past] = await listChats(bot.id);

    const continued = await call(`/api/v1/bots/${bot.id}/chats/${past.id}/continue`, {
      method: "POST",
    });
    expect(continued.status).toBe(200);
    expect(continued.body.data).toMatchObject({ conversationId: String(first) });
    expect(await chatOf(bot.id)).toBe(first);
    // The chat it left is stopped and recorded; the one it returned to is reconciled.
    expect(runtime.abort).toHaveBeenCalledWith(second);
    expect((await listChats(bot.id)).map((chat) => chat.title)).toEqual(["Current topic"]);
    expect(runtime.configure).toHaveBeenCalledWith(first, expect.anything());
  });

  it("deletes a past chat, and a deleted bot takes its past chats with it", async () => {
    const bot = await createBot();
    await converse(bot.id, "One");
    await newChat(bot.id);
    await converse(bot.id, "Two");
    await newChat(bot.id);
    const [two, one] = await listChats(bot.id);

    const deleted = await call(`/api/v1/bots/${bot.id}/chats/${two.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect((await listChats(bot.id)).map((chat) => chat.title)).toEqual(["One"]);
    expect(one).toBeDefined();

    expect((await call(`/api/v1/bots/${bot.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await db.$count(botChats)).toBe(0);
  });

  it("still starts a new chat when the old transcript cannot be read", async () => {
    const bot = await createBot();
    runtime.readChat.mockRejectedValueOnce(new Error("agent.db busy"));

    const fresh = await newChat(bot.id);

    expect(fresh.conversationId).not.toBe(bot.conversationId);
    expect(await chatOf(bot.id)).toBe(Number(fresh.conversationId));
    expect(await listChats(bot.id)).toEqual([]);
  });

  it("ends the bot's open chat stream when it moves to a new chat", async () => {
    const bot = await createBot();
    const response = await app.request(`/api/v1/bots/${bot.id}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    // The snapshot arrives first; then "New chat" ends the stream.
    while (!text.includes('"type":"snapshot"')) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before its snapshot");
      text += decoder.decode(value, { stream: true });
    }
    await newChat(bot.id);
    const ended = await until(async () => (await reader.read()).done, "the stream to end");
    expect(ended).toBe(true);
  });

  it("replaces the provisional title with the title model's", async () => {
    const completeSimple = vi.fn().mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text: '"Goa trip: December flights."' }],
    });
    setChatTitler({
      models: { getModel: vi.fn(() => ({ id: "title-model" })), completeSimple } as never,
      hasModel: () => true,
    });
    const bot = await createBot();
    await converse(bot.id, "Find flights to Goa");

    await newChat(bot.id);

    await vi.waitFor(async () => {
      expect((await listChats(bot.id))[0]).toMatchObject({ title: "Goa trip: December flights" });
    });
    expect(completeSimple).toHaveBeenCalledOnce();
    // The call carries an abort signal, so an overrun is stopped, not left running.
    expect(completeSimple.mock.calls[0]?.[2]).toMatchObject({ signal: expect.any(AbortSignal) });
  });
});
