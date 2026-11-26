import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, createTestApp } from "../helpers";
import { botGuests, bots, db, guests, users } from "../../../apps/web/src/server/db";
import { endAllSse } from "../../../apps/web/src/server/api/bots/bots.sse";
import {
  onBotChatEvent,
  type BotChatEvent,
} from "../../../apps/web/src/server/api/bots/bots.events";
import { botToolkits } from "../../../apps/web/src/server/api/bots/bot-toolkits";
import { InvalidAnswersError } from "../../../packages/agent/src/toolkits/questions";
import { CHAT_WINDOW } from "../../../packages/agent/src/transcript";
import type { AgentRuntime } from "../../../packages/agent/src/index";
import {
  authToken,
  closeAppRuntime,
  installFakeRuntime,
  openAppRuntime,
  resetAppTables,
  spyOnRuntime,
  TEST_MODEL,
  type SpiedRuntime,
} from "../fixtures";

const token = await authToken("bots-test@example.com");
const authorization = { Authorization: `Bearer ${token}` };

let rt: AgentRuntime;
let agentRuntime: SpiedRuntime;
let realWatchChat: AgentRuntime["watchChat"];
const conv = (bot: { conversationId: string }) => Number(bot.conversationId);
let activityListeners = 0;
let enabled: string[] = [];

const app = createTestApp();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

function call(path: string, init: { method?: string; json?: unknown } = {}) {
  return api<Data>(app, path, { ...init, token });
}

function withQuery(path: string, query: Record<string, string>): string {
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}

const findBot = (id: unknown) => db.query.bots.findFirst({ where: eq(bots.id, String(id)) });

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
  what: string,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what)), ms);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const createPayload = {
  name: "Research helper",
  description: "Finds answers",
  systemPrompt: "Be precise.",
  modelId: TEST_MODEL,
};

async function createBot(overrides: Record<string, unknown> = {}): Promise<Data> {
  const response = await call("/api/v1/bots", {
    method: "POST",
    json: { ...createPayload, ...overrides },
  });
  expect(response.status).toBe(201);
  return response.body.data;
}

async function readFirstSse(
  path: string,
  until = "data:",
): Promise<{ status: number; contentType: string | null; text: string }> {
  const response = await app.request(path, { headers: authorization });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!text.includes(until)) {
      const { value, done } = await readChunk(
        reader,
        3_000,
        `Timed out waiting for SSE data from ${path}`,
      );
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return { status: response.status, contentType: response.headers.get("content-type"), text };
}

describe("Bots API routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    rt = await openAppRuntime();
    const realOnActivity = rt.onActivity.bind(rt);
    realWatchChat = rt.watchChat.bind(rt);
    enabled = botToolkits({ modelId: TEST_MODEL }, rt.catalog);
    agentRuntime = spyOnRuntime(rt);
    activityListeners = 0;
    agentRuntime.onActivity.mockImplementation((listener) => {
      activityListeners += 1;
      const off = realOnActivity(listener);
      return () => {
        activityListeners -= 1;
        off();
      };
    });
    await resetAppTables();
  });

  afterEach(async () => {
    await resetAppTables();
    await closeAppRuntime();
  });

  it("requires authentication for bots routes", async () => {
    const response = await api(app, "/api/v1/bots");

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false });
  });

  it("lists the runtime model catalog in the standard envelope", async () => {
    const response = await call("/api/v1/models");
    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        models: rt.catalog.list({ type: "chat" }),
        defaultModelId: "test-model",
        canAnswer: true,
      },
    });
  });

  it("creates a bot row and its durable conversation", async () => {
    const response = await call("/api/v1/bots", { method: "POST", json: createPayload });
    expect(response.status).toBe(201);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.objectContaining({
        name: createPayload.name,
        modelId: createPayload.modelId,
        conversationId: expect.any(String),
      }),
    });
    expect(agentRuntime.createConversation).toHaveBeenCalledWith({
      modelId: createPayload.modelId,
      systemPrompt: createPayload.systemPrompt,
      capabilities: { enabled, permissions: {} },
    });

    const bot = await findBot(response.body.data.id);
    expect(bot).toMatchObject({
      name: createPayload.name,
      description: createPayload.description,
      systemPrompt: createPayload.systemPrompt,
      modelId: createPayload.modelId,
      conversationId: response.body.data.conversationId,
    });
    expect(await rt.readChat(Number(response.body.data.conversationId))).toMatchObject({
      messages: [],
    });
  });

  it("rejects a missing name and a model absent from the runtime catalog", async () => {
    const missingName = await call("/api/v1/bots", {
      method: "POST",
      json: { ...createPayload, name: "" },
    });
    const unknownModel = await call("/api/v1/bots", {
      method: "POST",
      json: { ...createPayload, modelId: "removed-model" },
    });

    expect(missingName.status).toBe(400);
    expect(unknownModel.status).toBe(400);
    expect(agentRuntime.createConversation).not.toHaveBeenCalled();
  });

  it("refuses a name another bot has, ignoring case and surrounding spaces (issue #80)", async () => {
    await createBot({ name: "Echo" });
    agentRuntime.createConversation.mockClear();

    for (const name of ["Echo", "echo", "  ECHO  "]) {
      const response = await call("/api/v1/bots", {
        method: "POST",
        json: { ...createPayload, name },
      });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        success: false,
        error: { message: 'A bot named "Echo" already exists' },
      });
    }
    expect(agentRuntime.createConversation).not.toHaveBeenCalled();
    await expect(db.$count(bots)).resolves.toBe(1);
  });

  it("refuses renaming onto another bot's name, but a bot may recase its own", async () => {
    const echo = await createBot({ name: "Echo" });
    const other = await createBot({ name: "Other" });

    for (const name of ["Echo", " eCHo "]) {
      const response = await call(`/api/v1/bots/${other.id}`, { method: "PATCH", json: { name } });
      expect(response.status).toBe(409);
      expect(response.body.error?.message).toBe('A bot named "Echo" already exists');
    }
    await expect(findBot(other.id)).resolves.toMatchObject({ name: "Other" });

    const recased = await call(`/api/v1/bots/${echo.id}`, {
      method: "PATCH",
      json: { name: "ECHO" },
    });
    expect(recased.status).toBe(200);
    expect(recased.body.data.name).toBe("ECHO");
    const saved = await call(`/api/v1/bots/${echo.id}`, {
      method: "PATCH",
      json: { name: "ECHO", description: "Echoes back" },
    });
    expect(saved.status).toBe(200);
  });

  it("patches a bot and reconfigures its existing durable conversation", async () => {
    const bot = await createBot();

    const response = await call(`/api/v1/bots/${bot.id}`, {
      method: "PATCH",
      json: { name: "Edited helper", systemPrompt: "Use bullet points.", modelId: TEST_MODEL },
    });
    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.objectContaining({ id: bot.id, name: "Edited helper" }),
    });
    expect(agentRuntime.configure).toHaveBeenCalledWith(conv(bot), {
      modelId: TEST_MODEL,
      systemPrompt: "Use bullet points.",
      capabilities: { enabled, permissions: {} },
    });
    await expect(findBot(bot.id)).resolves.toMatchObject({
      name: "Edited helper",
      systemPrompt: "Use bullet points.",
    });
  });

  it("patches only a bot's links without touching its row fields", async () => {
    const bot = await createBot();

    const response = await call(`/api/v1/bots/${bot.id}`, {
      method: "PATCH",
      json: { skillIds: [], connectionIds: [] },
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: bot.id, skillIds: [], connectionIds: [] });
    await expect(findBot(bot.id)).resolves.toMatchObject({ name: createPayload.name });

    const missing = await call("/api/v1/bots/no-such-bot", {
      method: "PATCH",
      json: { skillIds: [] },
    });
    expect(missing.status).toBe(404);
  });

  it("submits, aborts, and deletes through the runtime before removing the bot row", async () => {
    const bot = await createBot();

    const sent = await call(`/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "client-generated-id", text: "Hello" },
    });
    expect(sent.status).toBe(200);
    const aborted = await call(`/api/v1/bots/${bot.id}/abort`, { method: "POST", json: {} });
    expect(aborted.status).toBe(200);
    expect(agentRuntime.abort).toHaveBeenCalledWith(conv(bot));
    agentRuntime.abort.mockClear();
    expect((await call(`/api/v1/bots/${bot.id}`, { method: "DELETE" })).status).toBe(200);

    expect(agentRuntime.submit).toHaveBeenCalledWith(conv(bot), {
      requestId: "client-generated-id",
      text: "Hello",
    });
    expect(agentRuntime.abort).toHaveBeenCalledWith(conv(bot));
    await expect(findBot(bot.id)).resolves.toBeUndefined();
  });

  it("passes the steering mode through to the runtime on a busy send", async () => {
    const bot = await createBot();
    const steer = await call(`/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "steering-client-id", text: "change course", whenBusy: "steer" },
    });
    expect(steer.status).toBe(200);
    expect(agentRuntime.submit).toHaveBeenCalledWith(conv(bot), {
      requestId: "steering-client-id",
      text: "change course",
      whenBusy: "steer",
    });
    const plain = await call(`/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "plain-client-id", text: "plain hello" },
    });
    expect(plain.status).toBe(200);
    expect(agentRuntime.submit).toHaveBeenLastCalledWith(conv(bot), {
      requestId: "plain-client-id",
      text: "plain hello",
    });
    agentRuntime.submit.mockClear();
    const badMode = await call(`/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "bad-mode-client-id", text: "nope", whenBusy: "sideways" },
    });
    expect(badMode.status).toBe(400);
    expect(agentRuntime.submit).not.toHaveBeenCalled();
  });

  it("withdraws a queued message, refusing placed and unknown ones", async () => {
    const bot = await createBot();
    const withdraw = (requestId: string) =>
      call(`/api/v1/bots/${bot.id}/messages/${requestId}`, { method: "DELETE" });
    agentRuntime.withdraw.mockResolvedValueOnce("withdrawn");

    const response = await withdraw("steering-client-id");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { withdrawn: true } });
    expect(agentRuntime.withdraw).toHaveBeenCalledWith(conv(bot), "steering-client-id");

    agentRuntime.withdraw.mockResolvedValueOnce("already_placed");
    expect((await withdraw("steering-client-id")).status).toBe(409);
    agentRuntime.withdraw.mockResolvedValueOnce("settled");
    expect((await withdraw("steering-client-id")).status).toBe(409);
    agentRuntime.withdraw.mockResolvedValueOnce("not_found");
    expect((await withdraw("never-sent-id")).status).toBe(404);
  });

  it("still deletes the bot when stopping its conversation fails", async () => {
    const bot = await createBot();
    agentRuntime.abort.mockRejectedValueOnce(new Error("conversation gone"));

    expect((await call(`/api/v1/bots/${bot.id}`, { method: "DELETE" })).status).toBe(200);

    await expect(findBot(bot.id)).resolves.toBeUndefined();
  });

  it("resets by swapping to a newly created conversation", async () => {
    const bot = await createBot();

    const response = await call(`/api/v1/bots/${bot.id}/reset`, { method: "POST", json: {} });
    expect(response.status).toBe(200);

    const fresh = response.body.data.conversationId as string;
    expect(fresh).not.toBe(bot.conversationId);
    await expect(findBot(bot.id)).resolves.toMatchObject({ conversationId: fresh });
    expect(agentRuntime.abort).toHaveBeenCalledWith(conv(bot));
    expect(agentRuntime.abort).not.toHaveBeenCalledWith(Number(fresh));
  });

  it("caps concurrent streams per user at twenty", async () => {
    const bot = await createBot();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const response = await app.request(`/api/v1/bots/${bot.id}/stream`, {
        headers: authorization,
      });
      statuses.push(response.status);
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(20);
    expect(statuses[20]).toBe(429);

    endAllSse();
    const afterClose = await app.request(`/api/v1/bots/${bot.id}/stream`, {
      headers: authorization,
    });
    expect(afterClose.status).toBe(200);
    void afterClose.body!.cancel().catch(() => {});
  });

  it("ends open chat and activity streams on shutdown and stops their watches", async () => {
    const bot = await createBot();
    const stop = vi.fn(async () => undefined);
    agentRuntime.watchChat.mockImplementation(async (ref, listener, options) => {
      const subscription = await realWatchChat(ref, listener, options);
      return {
        initial: subscription.initial,
        stop: async () => {
          stop();
          await subscription.stop();
        },
      };
    });

    const openUntilEnded = async (path: string) => {
      const response = await app.request(path, { headers: authorization });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      let counted = false;
      for (;;) {
        const { value, done } = await readChunk(reader, 3_000, `${path} never ended`);
        if (done) return text;
        text += decoder.decode(value, { stream: true });
        if (!counted && text.includes("data:")) {
          counted = true;
          opened();
        }
      }
    };
    let pending = 2;
    const opened = () => {
      if (--pending === 0) endAllSse();
    };

    const [chat, activity] = await Promise.all([
      openUntilEnded(`/api/v1/bots/${bot.id}/stream`),
      openUntilEnded("/api/v1/events"),
    ]);

    expect(chat).toContain('"type":"snapshot"');
    expect(activity).toContain('"type":"activity"');
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(activityListeners).toBe(0);
  });

  it("gives every bot every toolkit and stores its tool permissions", async () => {
    const caps = await call("/api/v1/capabilities");
    expect(caps.status).toBe(200);
    expect(caps.body.data.capabilities.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining(["tasks", "routines", "skills", "memory", "today", "bots"]),
    );

    const created = await call("/api/v1/bots", {
      method: "POST",
      json: { ...createPayload, toolkits: ["web"], toolPermissions: { web_fetch: "ask" } },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ toolPermissions: { web_fetch: "ask" } });
    expect(created.body.data).not.toHaveProperty("toolkits");
    expect(agentRuntime.createConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        capabilities: {
          enabled: enabled,
          permissions: { web_fetch: "ask" },
        },
      }),
    );

    const patched = await call(`/api/v1/bots/${created.body.data.id}`, {
      method: "PATCH",
      json: { toolPermissions: { web_fetch: "off" } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.toolPermissions).toEqual({ web_fetch: "off" });
    expect(agentRuntime.configure).toHaveBeenLastCalledWith(conv(created.body.data), {
      modelId: TEST_MODEL,
      systemPrompt: "Be precise.",
      capabilities: {
        enabled: enabled,
        permissions: { web_fetch: "off" },
      },
    });
  });

  it("stores the auto-review switch and hands it to the conversation only when on", async () => {
    const created = await call("/api/v1/bots", { method: "POST", json: createPayload });
    expect(created.status).toBe(201);
    expect(created.body.data.autoReview).toBe(false);
    const off = { enabled: enabled, permissions: {} };
    expect(agentRuntime.createConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({ capabilities: off }),
    );

    const on = await call(`/api/v1/bots/${created.body.data.id}`, {
      method: "PATCH",
      json: { autoReview: true },
    });
    expect(on.status).toBe(200);
    expect(on.body.data.autoReview).toBe(true);
    expect(agentRuntime.configure).toHaveBeenLastCalledWith(
      conv(created.body.data),
      expect.objectContaining({ capabilities: { ...off, autoReview: true } }),
    );

    const offAgain = await call(`/api/v1/bots/${created.body.data.id}`, {
      method: "PATCH",
      json: { autoReview: false },
    });
    expect(offAgain.status).toBe(200);
    expect(agentRuntime.configure).toHaveBeenLastCalledWith(
      conv(created.body.data),
      expect.objectContaining({ capabilities: off }),
    );
  });

  const waitingCard = (name: string, extra: Record<string, unknown> = {}) =>
    agentRuntime.readChat.mockResolvedValueOnce({
      messages: [
        {
          id: "e1",
          role: "assistant",
          text: "",
          status: "streaming",
          createdAt: 0,
          toolCalls: [{ id: "t1", name, status: "awaiting_approval", taskId: 7, ...extra }],
        },
      ],
      busy: true,
      queued: [],
    } as never);

  it("answers approvals, with 'always allow' switching the tool to allow", async () => {
    const bot = await createBot();
    waitingCard("send_email");
    agentRuntime.decideApproval.mockResolvedValueOnce(undefined);
    const approved = await call(`/api/v1/bots/${bot.id}/approvals/7`, {
      method: "POST",
      json: { decision: "approved", alwaysAllow: "send_email" },
    });
    expect(approved.status).toBe(200);
    expect(agentRuntime.decideApproval).toHaveBeenCalledWith(conv(bot), 7, "approved");
    expect(agentRuntime.configure).toHaveBeenLastCalledWith(
      conv(bot),
      expect.objectContaining({
        capabilities: {
          enabled: enabled,
          permissions: { send_email: "allow" },
        },
      }),
    );
    const row = await findBot(bot.id);
    expect(JSON.parse(row!.toolPermissions)).toEqual({ send_email: "allow" });

    const stale = await call(`/api/v1/bots/${bot.id}/approvals/7`, {
      method: "POST",
      json: { decision: "denied" },
    });
    expect(stale.status).toBe(409);
    expect(agentRuntime.decideApproval).toHaveBeenLastCalledWith(conv(bot), 7, "denied");
  });

  it("'always allow' switches on only the tool being approved, never a vault use (S5)", async () => {
    const bot = await createBot();
    waitingCard("send_email");
    const widened = await call(`/api/v1/bots/${bot.id}/approvals/7`, {
      method: "POST",
      json: { decision: "approved", alwaysAllow: "run_command" },
    });
    expect(widened.status).toBe(400);
    expect(widened.body.error?.code).toBe("ALWAYS_ALLOW_MISMATCH");

    waitingCard("browser_fill_secret", { vault: { handle: "bank", kind: "login" } });
    const vault = await call(`/api/v1/bots/${bot.id}/approvals/7`, {
      method: "POST",
      json: { decision: "approved", alwaysAllow: "browser_fill_secret" },
    });
    expect(vault.status).toBe(400);

    const stale = await call(`/api/v1/bots/${bot.id}/approvals/7`, {
      method: "POST",
      json: { decision: "approved", alwaysAllow: "run_command" },
    });
    expect(stale.status).toBe(409);
    expect(JSON.parse((await findBot(bot.id))!.toolPermissions)).toEqual({});
    expect(agentRuntime.decideApproval).toHaveBeenCalledTimes(1);
  });

  describe("tool permissions set once for every bot", () => {
    afterEach(async () => {
      await call("/api/v1/tool-permissions", { method: "PUT", json: { permissions: {} } });
    });

    const lastPermissions = (bot: { conversationId: string }) =>
      agentRuntime.configure.mock.calls.findLast(([ref]) => ref === conv(bot))?.[1]?.capabilities
        ?.permissions;

    it("applies them to every bot, and a bot's own choice wins", async () => {
      const saved = await call("/api/v1/tool-permissions", {
        method: "PUT",
        json: { permissions: { send_email: "allow", run_command: "off" } },
      });
      expect(saved.status).toBe(200);
      expect(saved.body.data).toEqual({ permissions: { send_email: "allow", run_command: "off" } });
      expect((await call("/api/v1/tool-permissions")).body.data).toEqual({
        permissions: { send_email: "allow", run_command: "off" },
      });

      const plain = await createBot();
      expect(lastPermissions(plain)).toEqual({ send_email: "allow", run_command: "off" });
      const careful = await createBot({ name: "Careful", toolPermissions: { send_email: "ask" } });
      expect(lastPermissions(careful)).toEqual({ send_email: "ask", run_command: "off" });
    });

    it("applies them to a bot shared with guests too", async () => {
      await call("/api/v1/tool-permissions", {
        method: "PUT",
        json: { permissions: { send_email: "allow", run_command: "off" } },
      });
      const bot = await createBot();
      await db
        .insert(users)
        .values({ id: 990_960, email: "perm-guest@example.com", password: "!" })
        .onConflictDoNothing();
      await db.insert(guests).values({ userId: 990_960 });
      await db.insert(botGuests).values({ botId: bot.id, userId: 990_960 });
      await call(`/api/v1/bots/${bot.id}`, { method: "PATCH", json: { description: "Shared" } });
      expect(lastPermissions(bot)).toEqual({ send_email: "allow", run_command: "off" });
      await db.delete(users).where(eq(users.id, 990_960));
    });

    it("'always allow for every bot' allows the tool everywhere and drops this bot's own choice", async () => {
      const bot = await createBot({ toolPermissions: { send_email: "ask" } });
      waitingCard("send_email");
      agentRuntime.decideApproval.mockResolvedValueOnce(undefined);
      const approved = await call(`/api/v1/bots/${bot.id}/approvals/7`, {
        method: "POST",
        json: { decision: "approved", alwaysAllow: "send_email", everyBot: true },
      });
      expect(approved.status).toBe(200);
      expect((await call("/api/v1/tool-permissions")).body.data).toEqual({
        permissions: { send_email: "allow" },
      });
      expect(JSON.parse((await findBot(bot.id))!.toolPermissions)).toEqual({});
      expect(lastPermissions(bot)).toEqual({ send_email: "allow" });
    });
  });

  it("answers or dismisses a bot's questions", async () => {
    const bot = await createBot();
    const path = `/api/v1/bots/${bot.id}/questions/7`;
    const post = (json: unknown, to = path) => call(to, { method: "POST", json });
    const answers = [{ selected: ["Postgres"] }, { selected: [], text: "Ship it Friday" }];

    agentRuntime.answerQuestions.mockResolvedValueOnce(undefined);
    const answered = await post({ answers });
    expect(answered.status).toBe(200);
    expect(answered.body.data).toEqual({ answered: true });
    expect(agentRuntime.answerQuestions).toHaveBeenLastCalledWith(
      conv(bot),
      7,
      answers,
      expect.objectContaining({ answeredBy: undefined }),
    );
    agentRuntime.answerQuestions.mockResolvedValueOnce(undefined);
    const dismissed = await post({ dismissed: true });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data).toEqual({ dismissed: true });
    expect(agentRuntime.answerQuestions).toHaveBeenLastCalledWith(
      conv(bot),
      7,
      null,
      expect.objectContaining({ answeredBy: undefined }),
    );

    agentRuntime.answerQuestions.mockClear();
    for (const body of [
      {},
      { answers, dismissed: true },
      { answers: [] },
      { answers: [{ selected: "Postgres" }] },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    const zero = await post({ dismissed: true }, `/api/v1/bots/${bot.id}/questions/zero`);
    expect(zero.status).toBe(400);
    expect(agentRuntime.answerQuestions).not.toHaveBeenCalled();

    expect((await post({ answers })).status).toBe(409);
    expect(agentRuntime.answerQuestions).toHaveBeenCalledOnce();
    agentRuntime.answerQuestions.mockRejectedValueOnce(
      new InvalidAnswersError("Expected 3 answer(s), got 2"),
    );
    expect((await post({ answers })).status).toBe(400);
  });

  it("attributes a guest's answers to the guest, not the owner", async () => {
    const bot = await createBot();
    const guestEmail = `guest-${Date.now()}@example.com`;
    const guest = await call("/api/v1/people", {
      method: "POST",
      json: { name: "Priya", email: guestEmail, password: "secret-pass" },
    });
    expect(guest.status).toBe(201);
    const shared = await call(`/api/v1/bots/${bot.id}`, {
      method: "PATCH",
      json: { guestIds: [guest.body.data.id] },
    });
    expect(shared.status).toBe(200);

    const guestToken = await authToken(guestEmail, guest.body.data.id);
    agentRuntime.answerQuestions.mockResolvedValue(undefined);
    const answered = await api(app, `/api/v1/bots/${bot.id}/questions/7`, {
      method: "POST",
      json: { answers: [{ selected: ["Postgres"] }] },
      token: guestToken,
    });
    expect(answered.status).toBe(200);
    expect(agentRuntime.answerQuestions).toHaveBeenLastCalledWith(
      conv(bot),
      7,
      [{ selected: ["Postgres"] }],
      { answeredBy: "Priya (guest)" },
    );
  });

  it("an owner message dismisses the questions the bot is waiting on", async () => {
    const bot = await createBot();
    const path = `/api/v1/bots/${bot.id}/messages`;
    const first = await call(path, {
      method: "POST",
      json: { requestId: "no-questions-id", text: "Hello" },
    });
    expect(first.status).toBe(200);
    expect(agentRuntime.dismissQuestions).not.toHaveBeenCalled();

    agentRuntime.pendingQuestions.mockReturnValueOnce(1);
    const inChat = await call(path, {
      method: "POST",
      json: { requestId: "answer-in-chat-id", text: "Use SQLite", whenBusy: "steer" },
    });
    expect(inChat.status).toBe(200);
    expect(agentRuntime.dismissQuestions).toHaveBeenCalledWith(conv(bot));
    expect(agentRuntime.submit.mock.invocationCallOrder.at(-1)).toBeLessThan(
      agentRuntime.dismissQuestions.mock.invocationCallOrder[0],
    );
  });

  it("marks a bot as read", async () => {
    const bot = await createBot();

    const read = await call(`/api/v1/bots/${bot.id}/read`, { method: "POST", json: {} });
    expect(read.status).toBe(200);

    await expect(findBot(bot.id)).resolves.toMatchObject({
      lastReadAt: expect.any(Date),
    });
  });

  it("pins and unpins a bot without reconfiguring its conversation", async () => {
    const bot = await createBot();
    agentRuntime.configure.mockClear();

    const pin = (pinned: boolean) =>
      call(`/api/v1/bots/${bot.id}/pin`, { method: "POST", json: { pinned } });

    const pinned = await pin(true);
    expect(pinned.status).toBe(200);
    expect(pinned.body.data.pinnedAt).toEqual(expect.any(String));

    const again = await pin(true);
    expect(again.status).toBe(200);
    expect(again.body.data.pinnedAt).toBe(pinned.body.data.pinnedAt);

    const list = await call("/api/v1/bots");
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ id: bot.id, pinnedAt: pinned.body.data.pinnedAt });

    const unpinned = await pin(false);
    expect(unpinned.status).toBe(200);
    expect(unpinned.body.data.pinnedAt).toBeNull();
    expect(agentRuntime.configure).not.toHaveBeenCalled();
  });

  it("switches YOLO mode for the bot's current chat and tells its followers (issue #151)", async () => {
    const bot = await createBot();
    const heard: BotChatEvent[] = [];
    const off = onBotChatEvent(bot.id, (event) => heard.push(event));

    const on = await call(`/api/v1/bots/${bot.id}/yolo`, { method: "PUT", json: { on: true } });
    expect(on.status).toBe(200);
    expect(on.body.data).toEqual({ on: true, approved: [] });
    expect(agentRuntime.setYolo).toHaveBeenCalledWith(conv(bot), true, expect.any(Number));
    expect(await rt.yolo(conv(bot))).toBe(true);
    expect(heard).toEqual([{ type: "yolo", on: true }]);

    await call(`/api/v1/bots/${bot.id}/reset`, { method: "POST" });
    const fresh = await findBot(bot.id);
    expect(await rt.yolo(Number(fresh!.conversationId))).toBe(false);
    expect(heard.at(-1)).toEqual({ type: "chat-changed" });
    off();

    const invalid = await call(`/api/v1/bots/${bot.id}/yolo`, {
      method: "PUT",
      json: { on: "yes" },
    });
    expect(invalid.status).toBe(400);
    const missing = await call("/api/v1/bots/missing/yolo", { method: "PUT", json: { on: true } });
    expect(missing.status).toBe(404);
  });

  it("starts every new chat of a YOLO-by-default bot with YOLO on, trusting the owner", async () => {
    const bot = await createBot({ yoloByDefault: true });
    expect(bot.yoloByDefault).toBe(true);
    expect(await rt.yolo(conv(bot))).toBe(true);
    const owner = (await db.query.users.findFirst())!.id;
    expect(agentRuntime.setYolo).toHaveBeenCalledWith(conv(bot), true, owner);

    await call(`/api/v1/bots/${bot.id}/yolo`, { method: "PUT", json: { on: false } });
    await call(`/api/v1/bots/${bot.id}/reset`, { method: "POST" });
    const fresh = await findBot(bot.id);
    expect(await rt.yolo(Number(fresh!.conversationId))).toBe(true);

    const updated = await call(`/api/v1/bots/${bot.id}`, {
      method: "PATCH",
      json: { yoloByDefault: false },
    });
    expect(updated.body.data.yoloByDefault).toBe(false);
    await call(`/api/v1/bots/${bot.id}/reset`, { method: "POST" });
    const after = await findBot(bot.id);
    expect(await rt.yolo(Number(after!.conversationId))).toBe(false);
  });

  it("rejects an invalid pin body and an unknown bot", async () => {
    const bot = await createBot();
    const invalid = await call(`/api/v1/bots/${bot.id}/pin`, {
      method: "POST",
      json: { pinned: "yes" },
    });
    expect(invalid.status).toBe(400);
    const missing = await call("/api/v1/bots/missing/pin", {
      method: "POST",
      json: { pinned: true },
    });
    expect(missing.status).toBe(404);
  });

  it("returns list fields with preview and unread state", async () => {
    const earlier = new Date(Date.now() - 60_000);
    const later = new Date();
    await db.insert(bots).values({
      name: "Unread bot",
      description: "",
      systemPrompt: "",
      modelId: TEST_MODEL,
      conversationId: "301",
      lastReadAt: earlier,
      lastActivityAt: later,
      lastMessagePreview: "A fresh assistant reply",
    });
    await db.insert(bots).values({
      name: "Read bot",
      description: "",
      systemPrompt: "",
      modelId: TEST_MODEL,
      conversationId: "302",
      lastReadAt: later,
      lastActivityAt: earlier,
      lastMessagePreview: "Older reply",
    });

    agentRuntime.pendingQuestions.mockReturnValueOnce(2).mockReturnValueOnce(0);
    const response = await call("/api/v1/bots");
    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.arrayContaining([
        expect.objectContaining({
          name: "Unread bot",
          conversationId: "301",
          lastMessagePreview: "A fresh assistant reply",
          unread: true,
          approvals: 0,
          questions: 2,
        }),
        expect.objectContaining({
          name: "Read bot",
          conversationId: "302",
          lastMessagePreview: "Older reply",
          unread: false,
          questions: 0,
        }),
      ]),
    });
  });

  it("streams a chat snapshot over SSE", async () => {
    const bot = await createBot();

    const response = await readFirstSse(`/api/v1/bots/${bot.id}/stream`);

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/event-stream");
    expect(response.text).toContain("data:");
    expect(response.text).toContain('"type":"snapshot"');
    expect(agentRuntime.watchChat).toHaveBeenCalledWith(conv(bot), expect.any(Function), {
      window: CHAT_WINDOW,
    });
  });

  it("pages older transcript messages before a cursor (issue #92)", async () => {
    const bot = await createBot();
    const page = {
      messages: [
        { id: "e3", role: "user" as const, text: "older", status: "done" as const, createdAt: 3 },
      ],
      hasMore: true,
    };
    agentRuntime.readChatPage.mockResolvedValueOnce(page);

    const response = await call(
      withQuery(`/api/v1/bots/${bot.id}/messages`, { before: "e7", limit: "20" }),
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: page });
    expect(agentRuntime.readChatPage).toHaveBeenCalledWith(conv(bot), { before: "e7", limit: 20 });

    agentRuntime.readChatPage.mockResolvedValueOnce({ messages: [], hasMore: false });
    const defaults = await call(withQuery(`/api/v1/bots/${bot.id}/messages`, { before: "e7" }));
    expect(defaults.status).toBe(200);
    expect(agentRuntime.readChatPage).toHaveBeenLastCalledWith(conv(bot), {
      before: "e7",
      limit: 50,
    });
  });

  it("refuses history without auth, for an unknown bot, or with a bad cursor", async () => {
    const bot = await createBot();
    const path = `/api/v1/bots/${bot.id}/messages`;

    expect((await api(app, withQuery(path, { before: "e7" }))).status).toBe(401);
    const unknown = await call(withQuery("/api/v1/bots/no-such-bot/messages", { before: "e7" }));
    expect(unknown.status).toBe(404);
    const malformed: Record<string, string>[] = [
      {},
      { before: "live" },
      { before: "e7", limit: "0" },
      { before: "e7", limit: "101" },
    ];
    for (const query of malformed) {
      expect((await call(withQuery(path, query))).status).toBe(400);
    }
    const response = await call(withQuery(path, { before: "e999" }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false });
    expect(agentRuntime.readChatPage).toHaveBeenCalledTimes(1);
  });

  it("streams app-wide activity over SSE", async () => {
    await createBot();

    const response = await readFirstSse("/api/v1/events");

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/event-stream");
    expect(response.text).toContain("data:");
    expect(agentRuntime.onActivity).toHaveBeenCalledOnce();
  });
});

it("leaves the vision side-call out for a model with native vision", async () => {
  const fake = installFakeRuntime();
  await resetAppTables();
  const [bot] = await db
    .insert(bots)
    .values({
      id: "stalevision",
      name: "Stale Vision",
      systemPrompt: "You help.",
      modelId: "vision-model",
      conversationId: "777",
    })
    .returning();
  const response = await call(`/api/v1/bots/${bot!.id}/messages`, {
    method: "POST",
    json: { requestId: "stale-vision-check", text: "Hi" },
  });
  expect(response.status).toBe(200);
  expect(fake.configure).toHaveBeenCalledWith(777, {
    modelId: "vision-model",
    systemPrompt: "You help.",
    capabilities: {
      enabled: botToolkits({ modelId: "vision-model" }, fake.catalog),
      permissions: {},
    },
  });
  const created = await call("/api/v1/bots", {
    method: "POST",
    json: { ...createPayload, name: "Sees", modelId: "vision-model" },
  });
  expect(created.status).toBe(201);
  expect(fake.createConversation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      capabilities: {
        enabled: botToolkits({ modelId: "vision-model" }, fake.catalog),
        permissions: {},
      },
    }),
  );
});
