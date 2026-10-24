/** Uploads API (issue #17): upload, sniff, prepare, serve, delete, send paths. */
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { registerRoutes } from "../../../apps/web/src/server/routes";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { endAllSse } from "../../../apps/web/src/server/api/bots/bots.sse";

const authorization = {
  Authorization: `Bearer ${generateToken({ userId: 1, email: "uploads@example.com" })}`,
};

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  registerRoutes(app);
  app.use(errorHandlerMiddleware);
  return app;
}

// 1x1 transparent PNG (real bytes; Photon decodes it).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const models = [
  {
    id: "text-model",
    name: "Text Model",
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

const emptyChat = { messages: [], busy: false };
let nextConversationId = 100;
const agentRuntime = {
  createConversation: vi.fn().mockImplementation(async () => nextConversationId++),
  configure: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  watchChat: vi.fn(async (_ref: number, listener: (events: unknown[]) => void) => {
    await listener([{ type: "snapshot", state: emptyChat }]);
    return { initial: emptyChat, stop: async () => undefined };
  }),
  busyConversations: vi.fn().mockReturnValue([]),
  onActivity: vi.fn(() => () => undefined),
  listModels: vi.fn().mockReturnValue(models),
  hasModel: vi.fn().mockReturnValue(true),
  listCapabilities: vi.fn().mockReturnValue([]),
  pendingApprovals: vi.fn().mockReturnValue(0),
  decideApproval: vi.fn().mockResolvedValue(undefined),
  pendingQuestions: vi.fn().mockReturnValue(0),
  answerQuestions: vi.fn().mockResolvedValue(undefined),
  dismissQuestions: vi.fn().mockResolvedValue(undefined),
  attachmentIds: vi.fn().mockResolvedValue([]),
  close: vi.fn().mockResolvedValue(undefined),
};

async function createBot(app: Express, modelId: string): Promise<string> {
  const response = await request(app)
    .post("/api/v1/bots")
    .set(authorization)
    .send({ name: "Bot", modelId })
    .expect(201);
  return response.body.data.id as string;
}

async function uploadImage(app: Express): Promise<string> {
  const response = await request(app)
    .post("/api/v1/uploads")
    .set(authorization)
    .attach("file", TINY_PNG, { filename: "shot.png", contentType: "image/png" })
    .expect(200);
  return response.body.data.ref.uploadId as string;
}

beforeEach(async () => {
  await prisma.upload.deleteMany();
  await prisma.bot.deleteMany();
  setAgentRuntimeForTests(agentRuntime as never);
  nextConversationId = 100;
  agentRuntime.createConversation.mockImplementation(async () => nextConversationId++);
});

afterEach(async () => {
  await endAllSse();
  vi.clearAllMocks();
});

describe("uploads API", () => {
  it("stores an image, serves the original inline, and deletes", async () => {
    const app = buildApp();
    const uploadId = await uploadImage(app);

    const row = await prisma.upload.findUnique({ where: { id: uploadId } });
    expect(row?.kind).toBe("image");
    expect(row?.width).toBe(1);
    expect(row?.height).toBe(1);

    const content = await request(app)
      .get(`/api/v1/uploads/${uploadId}/content`)
      .set(authorization)
      .expect(200);
    expect(content.headers["content-type"]).toBe("image/png");
    expect(content.headers["content-disposition"]).toContain("inline");

    await request(app).delete(`/api/v1/uploads/${uploadId}`).set(authorization).expect(200);
    await expect(prisma.upload.findUnique({ where: { id: uploadId } })).resolves.toBeNull();
  });

  it("rejects a spoofed image (png name, text bytes)", async () => {
    const app = buildApp();
    await request(app)
      .post("/api/v1/uploads")
      .set(authorization)
      .attach("file", Buffer.from("just text, not an image"), {
        filename: "fake.png",
        contentType: "image/png",
      })
      .expect(400);
  });

  it("rejects unsupported extensions", async () => {
    const app = buildApp();
    await request(app)
      .post("/api/v1/uploads")
      .set(authorization)
      .attach("file", Buffer.from("MZ..."), {
        filename: "payload.exe",
        contentType: "application/octet-stream",
      })
      .expect(400);
  });

  it("serves files as attachments, never inline", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/api/v1/uploads")
      .set(authorization)
      .attach("file", Buffer.from("notes"), { filename: "notes.txt", contentType: "text/plain" })
      .expect(200);
    const id = response.body.data.ref.uploadId as string;
    const content = await request(app)
      .get(`/api/v1/uploads/${id}/content`)
      .set(authorization)
      .expect(200);
    expect(content.headers["content-disposition"]).toContain("attachment");
  });

  it("sends with attachments on a vision model as inline images", async () => {
    const app = buildApp();
    const botId = await createBot(app, "vision-model");
    const uploadId = await uploadImage(app);
    await request(app)
      .post(`/api/v1/bots/${botId}/messages`)
      .set(authorization)
      .send({ requestId: "attach-vision-1", text: "what is this?", attachments: [uploadId] })
      .expect(200);
    const submit = agentRuntime.submit.mock.calls[0][1];
    expect(submit.images).toHaveLength(1);
    expect(submit.attachments[0]).toMatchObject({ uploadId, kind: "image", name: "shot.png" });
    expect(submit.text).toBe("what is this?");
  });

  it("sends with attachments on a text model as see_image notes", async () => {
    const app = buildApp();
    const botId = await createBot(app, "text-model");
    const uploadId = await uploadImage(app);
    await request(app)
      .post(`/api/v1/bots/${botId}/messages`)
      .set(authorization)
      .send({ requestId: "attach-text-1", text: "", attachments: [uploadId] })
      .expect(200);
    const submit = agentRuntime.submit.mock.calls[0][1];
    expect(submit.images).toBeUndefined();
    expect(submit.text).toContain(`[image attached: shot.png`);
    expect(submit.text).toContain(uploadId);
    expect(submit.text).toContain("see_image");
    // Image-only send keeps a non-empty preview for the bot list.
    const bot = await prisma.bot.findUnique({ where: { id: botId } });
    expect(bot?.lastMessagePreview).toContain("[Image]");
  });

  it("rejects sends with unknown attachment ids", async () => {
    const app = buildApp();
    const botId = await createBot(app, "vision-model");
    await request(app)
      .post(`/api/v1/bots/${botId}/messages`)
      .set(authorization)
      .send({ requestId: "attach-bad-1", text: "hi", attachments: ["a".repeat(24)] })
      .expect(404);
    expect(agentRuntime.submit).not.toHaveBeenCalled();
  });

  it("accepts an image-only send and rejects an empty send", async () => {
    const app = buildApp();
    const botId = await createBot(app, "vision-model");
    await request(app)
      .post(`/api/v1/bots/${botId}/messages`)
      .set(authorization)
      .send({ requestId: "empty-send-1", text: "" })
      .expect(400);
    expect(agentRuntime.submit).not.toHaveBeenCalled();
  });
});
