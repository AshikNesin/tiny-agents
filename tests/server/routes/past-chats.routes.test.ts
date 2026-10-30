import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { api, createTestApp } from "../helpers";
import { db, botChats, bots } from "../../../apps/web/src/server/db";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { setChatTitler } from "../../../apps/web/src/server/api/bots/chats.title";
import { CHAT_WINDOW } from "../../../packages/agent/src/transcript";

/**
 * Past chats (issue #101): "New chat" records the chat it leaves, which the
 * owner can list, read (paged like the live chat), continue or delete.
 */

const token = await generateToken({ userId: 1, email: "past-chats-test@example.com" });

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: "done";
  createdAt: number;
};

/** Transcripts by conversation id; anything unlisted is empty. */
const transcripts = new Map<number, Msg[]>();
let nextConversation = 100;

function say(conversation: number, ...turns: string[]): void {
  transcripts.set(
    conversation,
    turns.map((text, i) => ({
      id: `e${i + 1}`,
      role: i % 2 === 0 ? "user" : "assistant",
      text,
      status: "done",
      createdAt: Date.now() - 60_000 + i,
    })),
  );
}

const agentRuntime = {
  createConversation: vi.fn(async () => nextConversation++),
  configure: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  readChat: vi.fn(async (ref: number) => ({
    messages: transcripts.get(ref) ?? [],
    busy: false,
    queued: [],
  })),
  isBusy: vi.fn().mockReturnValue(false),
  busyConversations: vi.fn().mockReturnValue([]),
  listModels: vi.fn().mockReturnValue([
    {
      id: "known-model",
      name: "Known Model",
      family: "other",
      reasoning: false,
      contextWindow: 8_192,
      vision: false,
    },
  ]),
  hasModel: vi.fn((modelId: string) => modelId === "known-model"),
  listCapabilities: vi.fn().mockReturnValue([]),
  pendingApprovals: vi.fn().mockReturnValue(0),
  pendingQuestions: vi.fn().mockReturnValue(0),
  close: vi.fn().mockResolvedValue(undefined),
};

const app = createTestApp();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data varies per route
type Data = any;

/** An authenticated JSON request through the app. */
function call(path: string, init: { method?: string; json?: unknown } = {}) {
  return api<Data>(app, path, { ...init, token });
}

async function createBot(name = "Travel"): Promise<{ id: string; conversationId: string }> {
  const response = await call("/api/v1/bots", {
    method: "POST",
    json: { name, systemPrompt: "Plan trips.", modelId: "known-model" },
  });
  expect(response.status).toBe(201);
  return response.body.data as { id: string; conversationId: string };
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
    vi.clearAllMocks();
    transcripts.clear();
    nextConversation = 100;
    setAgentRuntimeForTests(agentRuntime as never);
    setChatTitler(undefined);
    await db.delete(bots);
  });

  afterEach(async () => {
    setChatTitler(undefined);
    await db.delete(bots);
  });

  it("records the chat New chat leaves, titled by its first owner message", async () => {
    const bot = await createBot();
    say(
      Number(bot.conversationId),
      "  Find   flights to Goa\nin December",
      "Here are three options.",
    );

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
    say(100, "First topic", "ok");
    await newChat(bot.id);
    say(101, "Second topic", "ok");
    await newChat(bot.id);

    expect((await listChats(bot.id)).map((chat) => chat.title)).toEqual([
      "Second topic",
      "First topic",
    ]);
  });

  it("404s for an unknown bot and for another bot's chat", async () => {
    expect((await call("/api/v1/bots/nope/chats")).status).toBe(404);

    const travel = await createBot("Travel");
    const finance = await createBot("Finance");
    say(Number(travel.conversationId), "Trip", "ok");
    await newChat(travel.id);
    const [chat] = await listChats(travel.id);

    expect((await call(`/api/v1/bots/${finance.id}/chats/${chat.id}`)).status).toBe(404);
    expect(
      (await call(`/api/v1/bots/${finance.id}/chats/${chat.id}`, { method: "DELETE" })).status,
    ).toBe(404);
  });

  it("reads the newest window and pages older messages", async () => {
    const bot = await createBot();
    const turns = Array.from({ length: CHAT_WINDOW + 5 }, (_, i) => `turn ${i + 1}`);
    say(Number(bot.conversationId), ...turns);
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
    expect(view.state.hasMore).toBe(true);
    expect(view.runs).toEqual([]);

    const query = new URLSearchParams({ before: view.state.cursor, limit: "50" });
    const page = await call(`/api/v1/bots/${bot.id}/chats/${chat.id}/messages?${query}`);
    expect(page.status).toBe(200);
    expect(page.body.data).toMatchObject({ hasMore: false });
    expect((page.body.data.messages as Msg[]).map((m) => m.text)).toEqual(turns.slice(0, 5));
  });

  it("continues a past chat: the bot moves back, and the chat it left becomes a past chat", async () => {
    const bot = await createBot();
    say(100, "Old trip", "ok");
    await newChat(bot.id);
    say(101, "Current topic", "ok");
    const [old] = await listChats(bot.id);
    const startedAt = (await db.query.botChats.findFirst({
      where: eq(botChats.id, String(old.id)),
    }))!.startedAt;

    const response = await call(`/api/v1/bots/${bot.id}/chats/${old.id}/continue`, {
      method: "POST",
    });
    expect(response.status).toBe(200);

    expect(response.body.data).toMatchObject({ conversationId: "100" });
    const row = (await db.query.bots.findFirst({ where: eq(bots.id, bot.id) }))!;
    expect(row.chatStartedAt).toEqual(startedAt);
    // The chat it left is stopped and listed; the continued one is not.
    expect(agentRuntime.abort).toHaveBeenCalledWith(101);
    expect((await listChats(bot.id)).map((chat) => chat.title)).toEqual(["Current topic"]);
    // Reconciled: it runs on the bot's current config from its next turn.
    expect(agentRuntime.configure).toHaveBeenCalledWith(100, expect.anything());
  });

  it("deletes a past chat, and a deleted bot takes its past chats with it", async () => {
    const bot = await createBot();
    say(100, "One", "ok");
    await newChat(bot.id);
    say(101, "Two", "ok");
    await newChat(bot.id);
    const [two] = await listChats(bot.id);

    expect(
      (await call(`/api/v1/bots/${bot.id}/chats/${two.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect((await listChats(bot.id)).map((chat) => chat.title)).toEqual(["One"]);

    expect((await call(`/api/v1/bots/${bot.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await db.$count(botChats, eq(botChats.botId, bot.id))).toBe(0);
  });

  it("still starts a new chat when the old transcript cannot be read", async () => {
    const bot = await createBot();
    agentRuntime.readChat.mockRejectedValueOnce(new Error("agent.db busy"));

    const fresh = await newChat(bot.id);

    expect(fresh.conversationId).toBe("101");
    expect(await listChats(bot.id)).toEqual([]);
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
    say(Number(bot.conversationId), "Find flights to Goa", "Here are three.");

    await newChat(bot.id);

    await vi.waitFor(async () => {
      expect((await listChats(bot.id))[0]).toMatchObject({ title: "Goa trip: December flights" });
    });
    expect(completeSimple).toHaveBeenCalledOnce();
  });
});
