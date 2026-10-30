import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { api, createTestApp } from "../helpers";
import { db, bots, routineRuns, routines } from "../../../apps/web/src/server/db";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { endAllSse } from "../../../apps/web/src/server/api/bots/bots.sse";
import { BOT_TOOLKITS } from "../../../apps/web/src/server/api/bots/bots.conversation";
import {
  ApprovalNotPendingError,
  QuestionNotPendingError,
} from "../../../packages/agent/src/runtime";
import { InvalidAnswersError } from "../../../packages/agent/src/toolkits/questions";
import { CHAT_WINDOW } from "../../../packages/agent/src/transcript";

/**
 * Route tests run against an app-shaped runtime fake installed through
 * `setAgentRuntimeForTests()` (bots.runtime.ts), with the real SQLite test DB.
 */

const token = await generateToken({ userId: 1, email: "bots-test@example.com" });
const authorization = { Authorization: `Bearer ${token}` };

const models = [
  {
    id: "known-model",
    name: "Known Model",
    family: "other" as const,
    reasoning: false,
    contextWindow: 8_192,
    vision: false,
  },
  {
    id: "vision-model",
    name: "Vision Model",
    family: "other" as const,
    reasoning: false,
    contextWindow: 8_192,
    vision: true,
  },
];
const emptyChat = { messages: [], busy: false, queued: [] };
const activityListeners = new Set<(change: { conversation: number; busy: boolean }) => void>();

const agentRuntime = {
  createConversation: vi.fn().mockResolvedValue(100),
  configure: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  withdraw: vi.fn().mockResolvedValue("withdrawn"),
  readChatPage:
    vi.fn<
      (
        ref: number,
        query: { before: string; limit: number },
      ) => Promise<{ messages: unknown[]; hasMore: boolean } | undefined>
    >(),
  watchChat: vi.fn(
    async (
      _ref: number,
      listener: (events: [{ type: "snapshot"; state: typeof emptyChat }]) => void | Promise<void>,
    ) => {
      await listener([{ type: "snapshot", state: emptyChat }]);
      return { initial: emptyChat, stop: async () => undefined };
    },
  ),
  isBusy: vi.fn().mockReturnValue(false),
  busyConversations: vi.fn().mockReturnValue([]),
  onActivity: vi.fn((listener: (change: { conversation: number; busy: boolean }) => void) => {
    activityListeners.add(listener);
    listener({ conversation: 100, busy: true });
    return () => activityListeners.delete(listener);
  }),
  listModels: vi.fn().mockReturnValue(models),
  hasModel: vi.fn((modelId: string) => modelId === "known-model" || modelId === "vision-model"),
  listCapabilities: vi.fn().mockReturnValue([
    { id: "tasks", kind: "toolkit", name: "Tasks", description: "Tasks", tools: [] },
    { id: "web", kind: "toolkit", name: "Web", description: "Web", tools: [] },
  ]),
  pendingApprovals: vi.fn().mockReturnValue(0),
  decideApproval: vi.fn().mockResolvedValue(undefined),
  pendingQuestions: vi.fn().mockReturnValue(0),
  answerQuestions: vi.fn().mockResolvedValue(undefined),
  dismissQuestions: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

const app = createTestApp();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data varies per route
type Data = any;

/** An authenticated JSON request through the app (`api()` with this file's token). */
function call(path: string, init: { method?: string; json?: unknown } = {}) {
  return api<Data>(app, path, { ...init, token });
}

/** `path?key=value…` for a GET with a query string. */
function withQuery(path: string, query: Record<string, string>): string {
  const search = new URLSearchParams(query).toString();
  return search ? `${path}?${search}` : path;
}

const findBot = (id: unknown) => db.query.bots.findFirst({ where: eq(bots.id, String(id)) });

/** Read one chunk of an SSE body, or fail after `ms`. */
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
  modelId: "known-model",
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
  /** Read until the stream carries this text (the first event by default). */
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
    // The client goes away: the stream must end and drop its watches.
    await reader.cancel();
  }
  return { status: response.status, contentType: response.headers.get("content-type"), text };
}

describe("Bots API routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    activityListeners.clear();
    agentRuntime.createConversation.mockResolvedValue(100);
    agentRuntime.hasModel.mockImplementation(
      (modelId: string) => modelId === "known-model" || modelId === "vision-model",
    );
    agentRuntime.isBusy.mockReturnValue(false);
    agentRuntime.listModels.mockReturnValue(models);
    agentRuntime.watchChat.mockImplementation(async (_ref, listener) => {
      await listener([{ type: "snapshot", state: emptyChat }]);
      return { initial: emptyChat, stop: async () => undefined };
    });
    agentRuntime.onActivity.mockImplementation((listener) => {
      activityListeners.add(listener);
      listener({ conversation: 100, busy: true });
      return () => activityListeners.delete(listener);
    });
    setAgentRuntimeForTests(agentRuntime);
    await db.delete(bots);
  });

  afterEach(async () => {
    activityListeners.clear();
    await db.delete(bots);
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
        models,
        gatewayConfigured: expect.any(Boolean),
      },
    });
    expect(agentRuntime.listModels).toHaveBeenCalledOnce();
  });

  it("creates a bot row and its durable conversation", async () => {
    const response = await call("/api/v1/bots", { method: "POST", json: createPayload });
    expect(response.status).toBe(201);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.objectContaining({
        name: createPayload.name,
        modelId: createPayload.modelId,
        conversationId: "100",
      }),
    });
    expect(agentRuntime.createConversation).toHaveBeenCalledWith({
      modelId: createPayload.modelId,
      systemPrompt: createPayload.systemPrompt,
      // Every bot has every built-in toolkit (ADR 0004), plus the vision
      // side-call for a text-only model.
      capabilities: { enabled: [...BOT_TOOLKITS, "vision"], permissions: {} },
    });

    const bot = await findBot(response.body.data.id);
    expect(bot).toMatchObject({
      name: createPayload.name,
      description: createPayload.description,
      systemPrompt: createPayload.systemPrompt,
      modelId: createPayload.modelId,
      conversationId: "100",
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
    // Refused before a conversation was started for it.
    expect(agentRuntime.createConversation).not.toHaveBeenCalled();
    await expect(db.$count(bots)).resolves.toBe(1);
  });

  it("refuses renaming onto another bot's name, but a bot may recase its own", async () => {
    const echo = await createBot({ name: "Echo" });
    agentRuntime.createConversation.mockResolvedValueOnce(101);
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
    // Saving the dialog sends the bot's own name back unchanged.
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
      json: { name: "Edited helper", systemPrompt: "Use bullet points.", modelId: "known-model" },
    });
    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.objectContaining({ id: bot.id, name: "Edited helper" }),
    });
    expect(agentRuntime.configure).toHaveBeenCalledWith(100, {
      modelId: "known-model",
      systemPrompt: "Use bullet points.",
      capabilities: { enabled: [...BOT_TOOLKITS, "vision"], permissions: {} },
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
    expect(agentRuntime.abort).toHaveBeenCalledWith(100);
    agentRuntime.abort.mockClear();
    expect((await call(`/api/v1/bots/${bot.id}`, { method: "DELETE" })).status).toBe(200);

    expect(agentRuntime.submit).toHaveBeenCalledWith(100, {
      requestId: "client-generated-id",
      text: "Hello",
    });
    // Vision-model bots do NOT get the vision toolkit auto-included.
    const visionBot = await createBot({ modelId: "vision-model" });
    const again = await call(`/api/v1/bots/${visionBot.id}/messages`, {
      method: "POST",
      json: { requestId: "client-generated-id-2", text: "Hello again" },
    });
    expect(again.status).toBe(200);
    // Deleting stops whatever the now-hidden conversation was still doing.
    expect(agentRuntime.abort).toHaveBeenCalledWith(100);
    await expect(findBot(bot.id)).resolves.toBeUndefined();
  });

  it("passes the steering mode through to the runtime on a busy send", async () => {
    const bot = await createBot();
    const steer = await call(`/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "steering-client-id", text: "change course", whenBusy: "steer" },
    });
    expect(steer.status).toBe(200);
    expect(agentRuntime.submit).toHaveBeenCalledWith(100, {
      requestId: "steering-client-id",
      text: "change course",
      whenBusy: "steer",
    });
    // Without the flag the runtime keeps its default (a queued follow-up).
    const plain = await call(`/api/v1/bots/${bot.id}/messages`, {
      method: "POST",
      json: { requestId: "plain-client-id", text: "plain hello" },
    });
    expect(plain.status).toBe(200);
    expect(agentRuntime.submit).toHaveBeenLastCalledWith(100, {
      requestId: "plain-client-id",
      text: "plain hello",
    });
    // Unknown modes are rejected before the runtime sees anything.
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
    expect(agentRuntime.withdraw).toHaveBeenCalledWith(100, "steering-client-id");

    // Placed or settled inputs are a conflict; unknown ids are not found.
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
    agentRuntime.createConversation.mockResolvedValueOnce(200);

    const response = await call(`/api/v1/bots/${bot.id}/reset`, { method: "POST", json: {} });
    expect(response.status).toBe(200);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.objectContaining({ conversationId: "200" }),
    });
    await expect(findBot(bot.id)).resolves.toMatchObject({
      conversationId: "200",
    });
    // The old conversation's in-flight reply is stopped, the new one untouched.
    expect(agentRuntime.abort).toHaveBeenCalledWith(100);
    expect(agentRuntime.abort).not.toHaveBeenCalledWith(200);
  });

  it("ends open chat and activity streams on shutdown and stops their watches", async () => {
    const bot = await createBot();
    const stop = vi.fn(async () => undefined);
    agentRuntime.watchChat.mockImplementation(async (_ref, listener) => {
      await listener([{ type: "snapshot", state: emptyChat }]);
      return { initial: emptyChat, stop };
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
        // Both streams are open and have sent their snapshot: shut down.
        // Latch: one `data:` per stream, however many chunks deliver it.
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
    expect(activityListeners.size).toBe(0);
  });

  it("gives every bot every toolkit and stores its tool permissions", async () => {
    const caps = await call("/api/v1/capabilities");
    expect(caps.status).toBe(200);
    expect(caps.body.data.capabilities.map((c: { id: string }) => c.id)).toEqual(["tasks", "web"]);

    const created = await call("/api/v1/bots", {
      method: "POST",
      // A client still sending the old toolkit list is not refused; it is ignored.
      json: { ...createPayload, toolkits: ["web"], toolPermissions: { web_fetch: "ask" } },
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ toolPermissions: { web_fetch: "ask" } });
    expect(created.body.data).not.toHaveProperty("toolkits");
    expect(agentRuntime.createConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        capabilities: {
          enabled: [...BOT_TOOLKITS, "vision"],
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
    expect(agentRuntime.configure).toHaveBeenLastCalledWith(100, {
      modelId: "known-model",
      systemPrompt: "Be precise.",
      capabilities: {
        enabled: [...BOT_TOOLKITS, "vision"],
        permissions: { web_fetch: "off" },
      },
    });
  });

  it("stores the auto-review switch and hands it to the conversation only when on", async () => {
    const created = await call("/api/v1/bots", { method: "POST", json: createPayload });
    expect(created.status).toBe(201);
    expect(created.body.data.autoReview).toBe(false);
    const off = { enabled: [...BOT_TOOLKITS, "vision"], permissions: {} };
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
      100,
      expect.objectContaining({ capabilities: { ...off, autoReview: true } }),
    );

    const offAgain = await call(`/api/v1/bots/${created.body.data.id}`, {
      method: "PATCH",
      json: { autoReview: false },
    });
    expect(offAgain.status).toBe(200);
    expect(agentRuntime.configure).toHaveBeenLastCalledWith(
      100,
      expect.objectContaining({ capabilities: off }),
    );
  });

  it("answers approvals, with 'always allow' switching the tool to allow", async () => {
    const bot = await createBot();
    const approved = await call(`/api/v1/bots/${bot.id}/approvals/7`, {
      method: "POST",
      json: { decision: "approved", alwaysAllow: "send_email" },
    });
    expect(approved.status).toBe(200);
    expect(agentRuntime.decideApproval).toHaveBeenCalledWith(100, 7, "approved");
    expect(agentRuntime.configure).toHaveBeenLastCalledWith(
      100,
      expect.objectContaining({
        capabilities: {
          enabled: [...BOT_TOOLKITS, "vision"],
          permissions: { send_email: "allow" },
        },
      }),
    );
    const row = await findBot(bot.id);
    expect(JSON.parse(row!.toolPermissions)).toEqual({ send_email: "allow" });

    agentRuntime.decideApproval.mockRejectedValueOnce(new ApprovalNotPendingError(7));
    const stale = await call(`/api/v1/bots/${bot.id}/approvals/7`, {
      method: "POST",
      json: { decision: "denied" },
    });
    expect(stale.status).toBe(409);
  });

  it("answers or dismisses a bot's questions", async () => {
    const bot = await createBot();
    const path = `/api/v1/bots/${bot.id}/questions/7`;
    const post = (json: unknown, to = path) => call(to, { method: "POST", json });
    const answers = [{ selected: ["Postgres"] }, { selected: [], text: "Ship it Friday" }];

    const answered = await post({ answers });
    expect(answered.status).toBe(200);
    expect(answered.body.data).toEqual({ answered: true });
    expect(agentRuntime.answerQuestions).toHaveBeenLastCalledWith(100, 7, answers);
    const dismissed = await post({ dismissed: true });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data).toEqual({ dismissed: true });
    expect(agentRuntime.answerQuestions).toHaveBeenLastCalledWith(100, 7, null);

    // Neither or both, and malformed answers, never reach the runtime.
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

    agentRuntime.answerQuestions.mockRejectedValueOnce(new QuestionNotPendingError(7));
    expect((await post({ answers })).status).toBe(409);
    agentRuntime.answerQuestions.mockRejectedValueOnce(
      new InvalidAnswersError("Expected 3 answer(s), got 2"),
    );
    expect((await post({ answers })).status).toBe(400);
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
    expect(agentRuntime.dismissQuestions).toHaveBeenCalledWith(100);
    // Submitted first, so the message joins the reply the dismissal resumes.
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

    // Pinning again keeps the original position.
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
      modelId: "known-model",
      conversationId: "301",
      lastReadAt: earlier,
      lastActivityAt: later,
      lastMessagePreview: "A fresh assistant reply",
    });
    await db.insert(bots).values({
      name: "Read bot",
      description: "",
      systemPrompt: "",
      modelId: "known-model",
      conversationId: "302",
      lastReadAt: later,
      lastActivityAt: earlier,
      lastMessagePreview: "Older reply",
    });

    // Listed newest first: the unread bot has two questions waiting.
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
    // Only the newest messages (issue #92): older ones load from /messages.
    expect(agentRuntime.watchChat).toHaveBeenCalledWith(100, expect.any(Function), {
      window: CHAT_WINDOW,
    });
  });

  it("pages older transcript messages before a cursor (issue #92)", async () => {
    const bot = await createBot();
    const page = { messages: [{ id: "e3", role: "user", text: "older" }], hasMore: true };
    agentRuntime.readChatPage.mockResolvedValueOnce(page);

    const response = await call(
      withQuery(`/api/v1/bots/${bot.id}/messages`, { before: "e7", limit: "20" }),
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: page });
    expect(agentRuntime.readChatPage).toHaveBeenCalledWith(100, { before: "e7", limit: 20 });

    // The page size defaults to 50.
    agentRuntime.readChatPage.mockResolvedValueOnce({ messages: [], hasMore: false });
    const defaults = await call(withQuery(`/api/v1/bots/${bot.id}/messages`, { before: "e7" }));
    expect(defaults.status).toBe(200);
    expect(agentRuntime.readChatPage).toHaveBeenLastCalledWith(100, { before: "e7", limit: 50 });
  });

  it("refuses history without auth, for an unknown bot, or with a bad cursor", async () => {
    const bot = await createBot();
    const path = `/api/v1/bots/${bot.id}/messages`;

    expect((await api(app, withQuery(path, { before: "e7" }))).status).toBe(401);
    const unknown = await call(withQuery("/api/v1/bots/no-such-bot/messages", { before: "e7" }));
    expect(unknown.status).toBe(404);
    // Malformed: missing, not a message id, or a limit out of range.
    const malformed: Record<string, string>[] = [
      {},
      { before: "live" },
      { before: "e7", limit: "0" },
      { before: "e7", limit: "101" },
    ];
    for (const query of malformed) {
      expect((await call(withQuery(path, query))).status).toBe(400);
    }
    // Well-formed, but not (or no longer) in the transcript.
    agentRuntime.readChatPage.mockResolvedValueOnce(undefined);
    const response = await call(withQuery(path, { before: "e999" }));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false });
    expect(agentRuntime.readChatPage).toHaveBeenCalledTimes(1);
  });

  it("streams the bot's finished routine runs as cards beside the transcript (issue #63)", async () => {
    const bot = await createBot();
    const [routine] = await db
      .insert(routines)
      .values({
        botId: bot.id,
        name: "digest",
        prompt: "p",
        schedule: { kind: "interval", minutes: 60 },
        conversationId: "900",
      })
      .returning();
    await db.insert(routineRuns).values([
      {
        routineId: routine!.id,
        scheduledFor: new Date(),
        status: "succeeded",
        requestId: "routine:card:1",
        // In the bot's current thread (it started when the bot was created).
        finishedAt: new Date(Date.now() + 1000),
        output: "Digest ready.",
      },
      {
        routineId: routine!.id,
        scheduledFor: new Date("2026-10-21T03:30:00Z"),
        status: "awaiting",
        requestId: "routine:card:2",
      },
    ]);

    const response = await readFirstSse(`/api/v1/bots/${bot.id}/stream`, '"type":"routine-runs"');
    const event = response.text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; runs?: unknown[] })
      .find((parsed) => parsed.type === "routine-runs");
    // Only finished runs get a card; the awaiting one is still working.
    expect(event?.runs).toEqual([
      expect.objectContaining({
        routineName: "digest",
        status: "succeeded",
        output: "Digest ready.",
      }),
    ]);
    // The transcript itself is the chat's alone.
    expect(agentRuntime.watchChat).toHaveBeenCalledWith(100, expect.any(Function), {
      window: CHAT_WINDOW,
    });
  });

  it("leaves routine runs from before a new chat out of the new thread", async () => {
    const bot = await createBot();
    const [routine] = await db
      .insert(routines)
      .values({
        botId: bot.id,
        name: "digest",
        prompt: "p",
        schedule: { kind: "interval", minutes: 60 },
        conversationId: "901",
      })
      .returning();
    await db.insert(routineRuns).values({
      routineId: routine!.id,
      scheduledFor: new Date(),
      status: "succeeded",
      requestId: "routine:old-thread:1",
      finishedAt: new Date(),
      output: "From the old thread.",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await call(`/api/v1/bots/${bot.id}/reset`, { method: "POST" })).status).toBe(200);
    const after = (await findBot(bot.id))!;
    expect(after.chatStartedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

    const response = await readFirstSse(`/api/v1/bots/${bot.id}/stream`, '"type":"routine-runs"');
    const event = response.text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { type: string; runs?: unknown[] })
      .find((parsed) => parsed.type === "routine-runs");
    expect(event?.runs).toEqual([]);
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
  // The side-call's prompt section would order see_image calls with ids
  // that never reach a model that sees images inline (production:
  // fabricated upload_ ULIDs).
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
  expect(agentRuntime.configure).toHaveBeenCalledWith(777, {
    modelId: "vision-model",
    systemPrompt: "You help.",
    capabilities: { enabled: [...BOT_TOOLKITS], permissions: {} },
  });
});
