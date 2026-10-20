import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { registerRoutes } from "../../../../apps/web/src/server/routes";
import { setAgentRuntimeForTests } from "../../../../apps/web/src/server/api/bots/bots.runtime";

const token = generateToken({ userId: 1, email: "memories-test@example.com" });
const authorization = { Authorization: `Bearer ${token}` };

const agentRuntime = {
  createConversation: vi.fn().mockResolvedValue(200),
  configure: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  watchChat: vi
    .fn()
    .mockResolvedValue({ initial: { messages: [], busy: false }, stop: async () => undefined }),
  isBusy: vi.fn().mockReturnValue(false),
  busyConversations: vi.fn().mockReturnValue([]),
  lastMessage: vi.fn().mockResolvedValue(undefined),
  onActivity: vi.fn().mockReturnValue(() => undefined),
  listModels: vi.fn().mockReturnValue([
    {
      id: "known-model",
      name: "Known",
      family: "other",
      reasoning: false,
      contextWindow: 8192,
      vision: false,
    },
  ]),
  hasModel: vi.fn().mockReturnValue(true),
  listCapabilities: vi
    .fn()
    .mockReturnValue([
      { id: "tasks", kind: "toolkit", name: "Tasks", description: "Tasks", tools: [] },
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

async function seedBot(app: Express): Promise<string> {
  const response = await request(app)
    .post("/api/v1/bots")
    .set(authorization)
    .send({ name: "Memory bot", modelId: "known-model" })
    .expect(201);
  return response.body.data.id as string;
}

describe("Memories API routes", () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setAgentRuntimeForTests(agentRuntime as never);
    await prisma.memory.deleteMany();
    await prisma.bot.deleteMany();
    app = buildApp();
  });

  it("creates a manual memory and lists it", async () => {
    const botId = await seedBot(app);
    await request(app)
      .post(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .send({ text: "Prefers TypeScript over JavaScript", category: "preference" })
      .expect(201);

    const list = await request(app)
      .get(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .expect(200);
    const memories = list.body.data.memories as Array<Record<string, unknown>>;
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      text: "Prefers TypeScript over JavaScript",
      category: "preference",
      status: "active",
      source: "manual",
      confidence: null,
    });
  });

  it("rejects invalid category and over-length text at the boundary", async () => {
    const botId = await seedBot(app);
    await request(app)
      .post(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .send({ text: "x".repeat(301), category: "preference" })
      .expect(400);
    await request(app)
      .post(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .send({ text: "ok", category: "vibe" })
      .expect(400);
  });

  it("edits a memory and tombstones on delete; deleted rows leave the default list", async () => {
    const botId = await seedBot(app);
    const created = await request(app)
      .post(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .send({ text: "Works at exe.dev", category: "fact" })
      .expect(201);
    const id = created.body.data.memory.id as string;

    await request(app)
      .patch(`/api/v1/memories/${id}`)
      .set(authorization)
      .send({ text: "Works at exe.dev on Shelley" })
      .expect(200);

    await request(app).delete(`/api/v1/memories/${id}`).set(authorization).expect(200);

    const list = await request(app)
      .get(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .expect(200);
    expect(list.body.data.memories).toHaveLength(0);

    const row = await prisma.memory.findUnique({ where: { id } });
    expect(row?.status).toBe("deleted");
  });

  it("archives the oldest active rows past the budget", async () => {
    const botId = await seedBot(app);
    for (let i = 0; i < 101; i++) {
      await request(app)
        .post(`/api/v1/bots/${botId}/memories`)
        .set(authorization)
        .send({ text: `Fact number ${i}`, category: "fact" });
    }
    const list = await request(app)
      .get(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .query({ includeArchived: "true" })
      .expect(200);
    const memories = list.body.data.memories as Array<Record<string, unknown>>;
    expect(memories.filter((m) => m.status === "active")).toHaveLength(100);
    expect(memories.filter((m) => m.status === "archived")).toHaveLength(1);
    expect(memories.find((m) => m.status === "archived")).toMatchObject({ text: "Fact number 0" });
  });

  it("flips expired rows out of the active list", async () => {
    const botId = await seedBot(app);
    await prisma.memory.create({
      data: {
        botId,
        text: "Is traveling this week",
        category: "fact",
        status: "active",
        source: "manual",
        until: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    const list = await request(app)
      .get(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .query({ includeArchived: "true" })
      .expect(200);
    const statuses = (list.body.data.memories as Array<Record<string, unknown>>).map(
      (m) => m.status,
    );
    expect(statuses).not.toContain("active");
    expect(statuses).toContain("expired");
  });

  it("treats the string 'false' as false for includeArchived", async () => {
    const botId = await seedBot(app);
    await prisma.memory.create({
      data: { botId, text: "Archived one", category: "fact", status: "archived", source: "manual" },
    });
    const list = await request(app)
      .get(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .query({ includeArchived: "false" })
      .expect(200);
    expect(list.body.data.memories).toHaveLength(0);
  });

  it("404s for a missing bot and a missing memory", async () => {
    const botId = await seedBot(app);
    await request(app).get("/api/v1/bots/nope/memories").set(authorization).expect(404);
    await request(app)
      .post(`/api/v1/bots/${botId}/memories`)
      .set(authorization)
      .send({ text: "ok", category: "fact" })
      .expect(201);
    await request(app)
      .patch("/api/v1/memories/nope")
      .set(authorization)
      .send({ text: "x" })
      .expect(404);
  });

  it("toggles memoryEnabled through the existing bot update path", async () => {
    const botId = await seedBot(app);
    const off = await request(app)
      .patch(`/api/v1/bots/${botId}`)
      .set(authorization)
      .send({ memoryEnabled: false })
      .expect(200);
    expect(off.body.data.memoryEnabled).toBe(false);
    const row = await prisma.bot.findUnique({ where: { id: botId } });
    expect(row?.memoryEnabled).toBe(false);
  });
});
