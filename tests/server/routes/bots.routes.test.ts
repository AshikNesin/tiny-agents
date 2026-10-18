import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { registerRoutes } from "../../../apps/web/src/server/routes";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { endAllSse } from "../../../apps/web/src/server/api/bots/bots.sse";

/**
 * Expected runtime seam for route tests:
 * `bots.runtime.ts` exports `getAgentRuntime()`, `setAgentRuntimeForTests(mock)`,
 * and `agentRuntimeReady()`. The setter receives this app-shaped runtime mock.
 *
 * The Bot model/migration is being built in parallel. Until it lands, this suite
 * correctly fails because both the runtime seam and `bots` table do not exist.
 */

const token = generateToken({ userId: 1, email: "bots-test@example.com" });
const authorization = { Authorization: `Bearer ${token}` };

const models = [
  {
    id: "known-model",
    name: "Known Model",
    family: "other" as const,
    reasoning: false,
    contextWindow: 8_192,
  },
];
const emptyChat = { messages: [], busy: false };
const activityListeners = new Set<(change: { conversation: number; busy: boolean }) => void>();

const agentRuntime = {
  createConversation: vi.fn().mockResolvedValue(100),
  configure: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
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
  lastMessage: vi.fn().mockResolvedValue(undefined),
  onActivity: vi.fn((listener: (change: { conversation: number; busy: boolean }) => void) => {
    activityListeners.add(listener);
    listener({ conversation: 100, busy: true });
    return () => activityListeners.delete(listener);
  }),
  listModels: vi.fn().mockReturnValue(models),
  hasModel: vi.fn((modelId: string) => modelId === "known-model"),
  close: vi.fn().mockResolvedValue(undefined),
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandlerMiddleware);
  return app;
}

const createPayload = {
  name: "Research helper",
  description: "Finds answers",
  systemPrompt: "Be precise.",
  modelId: "known-model",
  avatarEmoji: "🔎",
  avatarColor: "#14b8a6",
};

async function createBot(app = buildApp()): Promise<Record<string, unknown>> {
  const response = await request(app)
    .post("/api/v1/bots")
    .set(authorization)
    .send(createPayload)
    .expect(201);
  return response.body.data as Record<string, unknown>;
}

async function readFirstSse(
  app: Express,
  path: string,
): Promise<{ status: number; contentType: string | undefined; text: string }> {
  return new Promise((resolveSse, rejectSse) => {
    let settled = false;
    let text = "";
    const timer = setTimeout(() => {
      if (!settled) rejectSse(new Error(`Timed out waiting for SSE data from ${path}`));
    }, 3_000);
    const stream = request(app)
      .get(path)
      .set(authorization)
      .buffer(false)
      // supertest's default parser buffers text/event-stream until the
      // response ends; override it so SSE chunks arrive as they are written.
      .parse((response, callback) => {
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          text += chunk;
          if (text.includes("data:")) {
            settled = true;
            clearTimeout(timer);
            stream.abort();
            resolveSse({
              status: response.statusCode,
              contentType: response.headers["content-type"],
              text,
            });
          }
        });
        response.on("error", (error: Error) => {
          if (!settled) {
            clearTimeout(timer);
            rejectSse(error);
          }
        });
        response.on("end", () => callback(null, ""));
      });

    stream.end((error) => {
      if (error && !settled) {
        clearTimeout(timer);
        rejectSse(error);
      }
    });
  });
}

describe("Bots API routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    activityListeners.clear();
    agentRuntime.createConversation.mockResolvedValue(100);
    agentRuntime.hasModel.mockImplementation((modelId: string) => modelId === "known-model");
    agentRuntime.isBusy.mockReturnValue(false);
    agentRuntime.lastMessage.mockResolvedValue(undefined);
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
    // Expected to fail until the Bot migration from PRD §8 is applied.
    await prisma.bot.deleteMany();
  });

  afterEach(async () => {
    activityListeners.clear();
    await prisma.bot.deleteMany();
  });

  it("requires authentication for bots routes", async () => {
    const response = await request(buildApp()).get("/api/v1/bots");

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ success: false });
  });

  it("lists the runtime model catalog in the standard envelope", async () => {
    const response = await request(buildApp()).get("/api/v1/models").set(authorization).expect(200);

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
    const response = await request(buildApp())
      .post("/api/v1/bots")
      .set(authorization)
      .send(createPayload)
      .expect(201);

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
    });

    const bot = await prisma.bot.findUnique({ where: { id: response.body.data.id } });
    expect(bot).toMatchObject({
      name: createPayload.name,
      description: createPayload.description,
      systemPrompt: createPayload.systemPrompt,
      modelId: createPayload.modelId,
      avatarEmoji: createPayload.avatarEmoji,
      avatarColor: createPayload.avatarColor,
      conversationId: "100",
    });
  });

  it("rejects a missing name and a model absent from the runtime catalog", async () => {
    const app = buildApp();
    const missingName = await request(app)
      .post("/api/v1/bots")
      .set(authorization)
      .send({ ...createPayload, name: "" });
    const unknownModel = await request(app)
      .post("/api/v1/bots")
      .set(authorization)
      .send({ ...createPayload, modelId: "removed-model" });

    expect(missingName.status).toBe(400);
    expect(unknownModel.status).toBe(400);
    expect(agentRuntime.createConversation).not.toHaveBeenCalled();
  });

  it("patches a bot and reconfigures its existing durable conversation", async () => {
    const bot = await createBot();

    const response = await request(buildApp())
      .patch(`/api/v1/bots/${bot.id}`)
      .set(authorization)
      .send({ name: "Edited helper", systemPrompt: "Use bullet points.", modelId: "known-model" })
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.objectContaining({ id: bot.id, name: "Edited helper" }),
    });
    expect(agentRuntime.configure).toHaveBeenCalledWith(100, {
      modelId: "known-model",
      systemPrompt: "Use bullet points.",
    });
    await expect(prisma.bot.findUnique({ where: { id: String(bot.id) } })).resolves.toMatchObject({
      name: "Edited helper",
      systemPrompt: "Use bullet points.",
    });
  });

  it("submits, aborts, and deletes through the runtime before removing the bot row", async () => {
    const bot = await createBot();
    const app = buildApp();

    await request(app)
      .post(`/api/v1/bots/${bot.id}/messages`)
      .set(authorization)
      .send({ requestId: "client-generated-id", text: "Hello" })
      .expect(200);
    await request(app).post(`/api/v1/bots/${bot.id}/abort`).set(authorization).send({}).expect(200);
    expect(agentRuntime.abort).toHaveBeenCalledWith(100);
    agentRuntime.abort.mockClear();
    await request(app).delete(`/api/v1/bots/${bot.id}`).set(authorization).expect(200);

    expect(agentRuntime.submit).toHaveBeenCalledWith(100, {
      requestId: "client-generated-id",
      text: "Hello",
    });
    // Deleting stops whatever the now-hidden conversation was still doing.
    expect(agentRuntime.abort).toHaveBeenCalledWith(100);
    await expect(prisma.bot.findUnique({ where: { id: String(bot.id) } })).resolves.toBeNull();
  });

  it("still deletes the bot when stopping its conversation fails", async () => {
    const bot = await createBot();
    agentRuntime.abort.mockRejectedValueOnce(new Error("conversation gone"));

    await request(buildApp()).delete(`/api/v1/bots/${bot.id}`).set(authorization).expect(200);

    await expect(prisma.bot.findUnique({ where: { id: String(bot.id) } })).resolves.toBeNull();
  });

  it("resets by swapping to a newly created conversation", async () => {
    const bot = await createBot();
    agentRuntime.createConversation.mockResolvedValueOnce(200);

    const response = await request(buildApp())
      .post(`/api/v1/bots/${bot.id}/reset`)
      .set(authorization)
      .send({})
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.objectContaining({ conversationId: "200" }),
    });
    await expect(prisma.bot.findUnique({ where: { id: String(bot.id) } })).resolves.toMatchObject({
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
    const app = buildApp();

    const openUntilEnded = (path: string) =>
      new Promise<string>((resolveEnd, rejectEnd) => {
        let text = "";
        let ended = false;
        const timer = setTimeout(() => rejectEnd(new Error(`${path} never ended`)), 3_000);
        request(app)
          .get(path)
          .set(authorization)
          .buffer(false)
          .parse((response, callback) => {
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              text += chunk;
              // Both streams are open and have sent their snapshot: shut down.
              if (!ended && text.includes("data:")) opened();
            });
            response.on("end", () => {
              ended = true;
              clearTimeout(timer);
              resolveEnd(text);
              callback(null, "");
            });
          })
          .end(() => undefined);
      });
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

  it("marks a bot as read", async () => {
    const bot = await createBot();

    await request(buildApp())
      .post(`/api/v1/bots/${bot.id}/read`)
      .set(authorization)
      .send({})
      .expect(200);

    await expect(prisma.bot.findUnique({ where: { id: String(bot.id) } })).resolves.toMatchObject({
      lastReadAt: expect.any(Date),
    });
  });

  it("returns list fields with preview and unread state", async () => {
    const earlier = new Date(Date.now() - 60_000);
    const later = new Date();
    await prisma.bot.create({
      data: {
        name: "Unread bot",
        description: "",
        systemPrompt: "",
        modelId: "known-model",
        avatarColor: "#14b8a6",
        conversationId: "301",
        lastReadAt: earlier,
        lastActivityAt: later,
        lastMessagePreview: "A fresh assistant reply",
      },
    });
    await prisma.bot.create({
      data: {
        name: "Read bot",
        description: "",
        systemPrompt: "",
        modelId: "known-model",
        avatarColor: "#0f172a",
        conversationId: "302",
        lastReadAt: later,
        lastActivityAt: earlier,
        lastMessagePreview: "Older reply",
      },
    });

    const response = await request(buildApp()).get("/api/v1/bots").set(authorization).expect(200);

    expect(response.body).toMatchObject({
      success: true,
      data: expect.arrayContaining([
        expect.objectContaining({
          name: "Unread bot",
          lastMessagePreview: "A fresh assistant reply",
          unread: true,
        }),
        expect.objectContaining({
          name: "Read bot",
          lastMessagePreview: "Older reply",
          unread: false,
        }),
      ]),
    });
  });

  it("streams a chat snapshot over SSE", async () => {
    const bot = await createBot();

    const response = await readFirstSse(buildApp(), `/api/v1/bots/${bot.id}/stream`);

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/event-stream");
    expect(response.text).toContain("data:");
    expect(response.text).toContain('"type":"snapshot"');
    expect(agentRuntime.watchChat).toHaveBeenCalledWith(100, expect.any(Function));
  });

  it("streams app-wide activity over SSE", async () => {
    await createBot();

    const response = await readFirstSse(buildApp(), "/api/v1/events");

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/event-stream");
    expect(response.text).toContain("data:");
    expect(agentRuntime.onActivity).toHaveBeenCalledOnce();
  });
});
