import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { registerRoutes } from "../../../apps/web/src/server/routes";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { endAllSse } from "../../../apps/web/src/server/api/bots/bots.sse";
import { BOT_TOOLKITS } from "../../../apps/web/src/server/api/bots/bots.conversation";
import { ApprovalNotPendingError } from "../../../packages/agent/src/runtime";

/**
 * Route tests run against an app-shaped runtime fake installed through
 * `setAgentRuntimeForTests()` (bots.runtime.ts), with the real Prisma test DB.
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
};

async function createBot(
  app = buildApp(),
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await request(app)
    .post("/api/v1/bots")
    .set(authorization)
    .send({ ...createPayload, ...overrides })
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
      // Every bot has every built-in toolkit (ADR 0004), plus the vision
      // side-call for a text-only model.
      capabilities: { enabled: [...BOT_TOOLKITS, "vision"], permissions: {} },
    });

    const bot = await prisma.bot.findUnique({ where: { id: response.body.data.id } });
    expect(bot).toMatchObject({
      name: createPayload.name,
      description: createPayload.description,
      systemPrompt: createPayload.systemPrompt,
      modelId: createPayload.modelId,
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
      capabilities: { enabled: [...BOT_TOOLKITS, "vision"], permissions: {} },
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
    // Vision-model bots do NOT get the vision toolkit auto-included.
    const visionBot = await createBot(undefined, { modelId: "vision-model" });
    await request(buildApp())
      .post(`/api/v1/bots/${visionBot.id}/messages`)
      .set(authorization)
      .send({ requestId: "client-generated-id-2", text: "Hello again" })
      .expect(200);
    // Deleting stops whatever the now-hidden conversation was still doing.
    expect(agentRuntime.abort).toHaveBeenCalledWith(100);
    await expect(prisma.bot.findUnique({ where: { id: String(bot.id) } })).resolves.toBeNull();
  });

  it("passes the steering mode through to the runtime on a busy send", async () => {
    const bot = await createBot();
    const app = buildApp();
    await request(app)
      .post(`/api/v1/bots/${bot.id}/messages`)
      .set(authorization)
      .send({ requestId: "steering-client-id", text: "change course", whenBusy: "steer" })
      .expect(200);
    expect(agentRuntime.submit).toHaveBeenCalledWith(100, {
      requestId: "steering-client-id",
      text: "change course",
      whenBusy: "steer",
    });
    // Without the flag the runtime keeps its default (a queued follow-up).
    await request(app)
      .post(`/api/v1/bots/${bot.id}/messages`)
      .set(authorization)
      .send({ requestId: "plain-client-id", text: "plain hello" })
      .expect(200);
    expect(agentRuntime.submit).toHaveBeenLastCalledWith(100, {
      requestId: "plain-client-id",
      text: "plain hello",
    });
    // Unknown modes are rejected before the runtime sees anything.
    agentRuntime.submit.mockClear();
    await request(buildApp())
      .post(`/api/v1/bots/${bot.id}/messages`)
      .set(authorization)
      .send({ requestId: "bad-mode-client-id", text: "nope", whenBusy: "sideways" })
      .expect(400);
    expect(agentRuntime.submit).not.toHaveBeenCalled();
  });

  it("withdraws a queued message, refusing placed and unknown ones", async () => {
    const bot = await createBot();
    const app = buildApp();
    agentRuntime.withdraw.mockResolvedValueOnce("withdrawn");

    await request(app)
      .delete(`/api/v1/bots/${bot.id}/messages/steering-client-id`)
      .set(authorization)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ success: true, data: { withdrawn: true } });
      });
    expect(agentRuntime.withdraw).toHaveBeenCalledWith(100, "steering-client-id");

    // Placed or settled inputs are a conflict; unknown ids are not found.
    agentRuntime.withdraw.mockResolvedValueOnce("already_placed");
    await request(app)
      .delete(`/api/v1/bots/${bot.id}/messages/steering-client-id`)
      .set(authorization)
      .expect(409);
    agentRuntime.withdraw.mockResolvedValueOnce("settled");
    await request(app)
      .delete(`/api/v1/bots/${bot.id}/messages/steering-client-id`)
      .set(authorization)
      .expect(409);
    agentRuntime.withdraw.mockResolvedValueOnce("not_found");
    await request(app)
      .delete(`/api/v1/bots/${bot.id}/messages/never-sent-id`)
      .set(authorization)
      .expect(404);
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
        let counted = false;
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
              // Latch: one `data:` per stream, however many chunks deliver it —
              // chunked delivery (postgres) would otherwise double-fire opened().
              if (!counted && text.includes("data:")) {
                counted = true;
                opened();
              }
            });
            response.on("end", () => {
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

  it("gives every bot every toolkit and stores its tool permissions", async () => {
    const app = buildApp();
    const caps = await request(app).get("/api/v1/capabilities").set(authorization).expect(200);
    expect(caps.body.data.capabilities.map((c: { id: string }) => c.id)).toEqual(["tasks", "web"]);

    const created = await request(app)
      .post("/api/v1/bots")
      .set(authorization)
      // A client still sending the old toolkit list is not refused; it is ignored.
      .send({ ...createPayload, toolkits: ["web"], toolPermissions: { web_fetch: "ask" } })
      .expect(201);
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

    const patched = await request(app)
      .patch(`/api/v1/bots/${created.body.data.id}`)
      .set(authorization)
      .send({ toolPermissions: { web_fetch: "off" } })
      .expect(200);
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

  it("answers approvals, with 'always allow' switching the tool to allow", async () => {
    const bot = await createBot();
    const app = buildApp();
    await request(app)
      .post(`/api/v1/bots/${bot.id}/approvals/7`)
      .set(authorization)
      .send({ decision: "approved", alwaysAllow: "send_email" })
      .expect(200);
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
    const row = await prisma.bot.findUnique({ where: { id: String(bot.id) } });
    expect(JSON.parse(row!.toolPermissions)).toEqual({ send_email: "allow" });

    agentRuntime.decideApproval.mockRejectedValueOnce(new ApprovalNotPendingError(7));
    await request(app)
      .post(`/api/v1/bots/${bot.id}/approvals/7`)
      .set(authorization)
      .send({ decision: "denied" })
      .expect(409);
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

  it("pins and unpins a bot without reconfiguring its conversation", async () => {
    const bot = await createBot();
    agentRuntime.configure.mockClear();

    const pinned = await request(buildApp())
      .post(`/api/v1/bots/${bot.id}/pin`)
      .set(authorization)
      .send({ pinned: true })
      .expect(200);
    expect(pinned.body.data.pinnedAt).toEqual(expect.any(String));

    // Pinning again keeps the original position.
    const again = await request(buildApp())
      .post(`/api/v1/bots/${bot.id}/pin`)
      .set(authorization)
      .send({ pinned: true })
      .expect(200);
    expect(again.body.data.pinnedAt).toBe(pinned.body.data.pinnedAt);

    const list = await request(buildApp()).get("/api/v1/bots").set(authorization).expect(200);
    expect(list.body.data[0]).toMatchObject({ id: bot.id, pinnedAt: pinned.body.data.pinnedAt });

    const unpinned = await request(buildApp())
      .post(`/api/v1/bots/${bot.id}/pin`)
      .set(authorization)
      .send({ pinned: false })
      .expect(200);
    expect(unpinned.body.data.pinnedAt).toBeNull();
    expect(agentRuntime.configure).not.toHaveBeenCalled();
  });

  it("rejects an invalid pin body and an unknown bot", async () => {
    const bot = await createBot();
    await request(buildApp())
      .post(`/api/v1/bots/${bot.id}/pin`)
      .set(authorization)
      .send({ pinned: "yes" })
      .expect(400);
    await request(buildApp())
      .post("/api/v1/bots/missing/pin")
      .set(authorization)
      .send({ pinned: true })
      .expect(404);
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
          conversationId: "301",
          lastMessagePreview: "A fresh assistant reply",
          unread: true,
        }),
        expect.objectContaining({
          name: "Read bot",
          conversationId: "302",
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

it("leaves the vision side-call out for a model with native vision", async () => {
  // The side-call's prompt section would order see_image calls with ids
  // that never reach a model that sees images inline (production:
  // fabricated upload_ ULIDs).
  const bot = await prisma.bot.create({
    data: {
      id: "stalevision",
      name: "Stale Vision",
      systemPrompt: "You help.",
      modelId: "vision-model",
      conversationId: "777",
    },
  });
  await request(buildApp())
    .post(`/api/v1/bots/${bot.id}/messages`)
    .set(authorization)
    .send({ requestId: "stale-vision-check", text: "Hi" })
    .expect(200);
  expect(agentRuntime.configure).toHaveBeenCalledWith(777, {
    modelId: "vision-model",
    systemPrompt: "You help.",
    capabilities: { enabled: [...BOT_TOOLKITS], permissions: {} },
  });
});
