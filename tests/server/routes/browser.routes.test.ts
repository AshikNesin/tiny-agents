/**
 * Browser routes (issue #24): status, input, driver, live MJPEG — against
 * the app's express stack with a live fake session injected into the
 * toolkit's session map (the same seam the production toolkit uses).
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { prisma } from "@groot/core/database";
import { errorHandlerMiddleware } from "@groot/core/middlewares/error-handler.middleware";
import { generateToken } from "@groot/core/utils/jwt.utils";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import express from "express";
import { registerRoutes } from "../../../apps/web/src/server/routes";
import { vi } from "vite-plus/test";
import {
  getLiveBrowserSession,
  resetBrowserSessionsForTests,
  setDriver,
  type BrowserSession,
} from "../../../packages/agent/src/toolkits/browser";

const token = generateToken({ userId: 1, email: "browser-test@example.com" });
const authorization = { Authorization: `Bearer ${token}` };

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerRoutes(app);
  app.use(errorHandlerMiddleware);
  return app;
}

function fakeSession() {
  const events: unknown[] = [];
  let driver: "agent" | "human" = "agent";
  const listeners = new Set<{ frame?(f: { jpeg: Buffer }): void }>();
  const session: BrowserSession = {
    url: () => "https://example.com/page",
    on: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    navigate: async () => ({ url: "https://example.com/page", status: 200 }),
    snapshot: async () => "- body [ref=e1]",
    click: async () => ({ url: "https://example.com/page" }),
    type: async () => ({ url: "https://example.com/page" }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    input: async (event) => {
      events.push(event);
    },
    startScreencast: async () => {
      // Emit one synthetic frame so the MJPEG test can read it.
      setTimeout(() => {
        for (const l of listeners) l.frame?.({ jpeg: Buffer.from("jpegbytes") });
      }, 30);
    },
    stopScreencast: async () => {},
    close: async () => {},
  };
  return {
    session,
    events,
    get driver() {
      return driver;
    },
  };
}

// The routes read sessions through the toolkit's exported helpers; the test
// injects by calling the internal map through a probe conversation id.
import { acquire } from "../../../packages/agent/src/toolkits/browser";

const agentRuntime = {
  createConversation: vi
    .fn()
    .mockImplementation(async () => Math.floor(Math.random() * 100000) + 1000),
  configure: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  watchChat: vi.fn(async () => ({ stop: async () => undefined })),
  onActivity: vi.fn(() => () => undefined),
  hasModel: vi.fn(() => true),
  isBusy: vi.fn(() => false),
  listModels: vi.fn(() => [
    { id: "m", name: "M", family: "other", reasoning: false, contextWindow: 8192, vision: false },
  ]),
  lastMessage: vi.fn(async () => undefined),
  busyConversations: vi.fn(() => []),
  listCapabilities: vi.fn(() => []),
};

describe("browser routes", () => {
  beforeEach(() => {
    setAgentRuntimeForTests(agentRuntime as never);
  });
  const app = buildApp();
  let conversationId: number;
  let botId: string;
  let fake: ReturnType<typeof fakeSession>;

  beforeEach(async () => {
    await prisma.bot.deleteMany();
    const response = await request(app)
      .post("/api/v1/bots")
      .set(authorization)
      .send({ name: "B", modelId: "m", systemPrompt: "" })
      .expect(201);
    botId = response.body.data.id;
    conversationId = Number(response.body.data.conversationId);

    fake = fakeSession();
    resetBrowserSessionsForTests();
    // Inject: transport returns the fake session.
    await acquire(
      { transport: async () => fake.session, profilesDir: "/tmp/ta-route-profiles" },
      conversationId,
    );
  });

  afterEach(async () => {
    resetBrowserSessionsForTests();
    await prisma.bot.deleteMany();
  });

  it("reports inactive status when no session exists", async () => {
    resetBrowserSessionsForTests();
    const r = await request(app)
      .get(`/api/v1/bots/${botId}/browser`)
      .set(authorization)
      .expect(200);
    expect(r.body.data).toEqual({ active: false, url: null, driver: null });
  });

  it("reports active status with url and driver", async () => {
    const r = await request(app)
      .get(`/api/v1/bots/${botId}/browser`)
      .set(authorization)
      .expect(200);
    expect(r.body.data.active).toBe(true);
    expect(r.body.data.url).toBe("https://example.com/page");
    expect(r.body.data.driver).toBe("agent");
  });

  it("streams MJPEG frames with the boundary content type", { timeout: 8000 }, async () => {
    // supertest's parsers fight streaming responses; use a real socket.
    const { createServer } = await import("node:http");
    const server = createServer(app);
    await new Promise<void>((resolveListen) => server.listen(0, resolveListen));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/bots/${botId}/browser/live`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("multipart/x-mixed-replace");
      expect(res.headers.get("x-accel-buffering")).toBe("no");
      const reader = res.body!.getReader();
      const { value } = await Promise.race([
        reader.read(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("no frame in 3s")), 3000)),
      ]);
      expect(Buffer.from(value!).toString()).toContain("jpegbytes");
      await reader.cancel();
    } finally {
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  });

  it("injects input events into the session", async () => {
    await request(app)
      .post(`/api/v1/bots/${botId}/browser/input`)
      .set(authorization)
      .send({ kind: "key", key: "h", text: "h" })
      .expect(200);
    expect(fake.events).toEqual([{ kind: "key", key: "h", text: "h" }]);
  });

  it("rejects malformed input", async () => {
    await request(app)
      .post(`/api/v1/bots/${botId}/browser/input`)
      .set(authorization)
      .send({ kind: "mouse" })
      .expect(400);
  });

  it("flips the driver and back", async () => {
    const take = await request(app)
      .post(`/api/v1/bots/${botId}/browser/driver`)
      .set(authorization)
      .send({ driver: "human" })
      .expect(200);
    expect(take.body.data.driver).toBe("human");
    expect(getLiveBrowserSession(conversationId)?.driver).toBe("human");
    const release = await request(app)
      .post(`/api/v1/bots/${botId}/browser/driver`)
      .set(authorization)
      .send({ driver: "agent" })
      .expect(200);
    expect(release.body.data.driver).toBe("agent");
  });

  it("404s driver flip when no session exists", async () => {
    resetBrowserSessionsForTests();
    await request(app)
      .post(`/api/v1/bots/${botId}/browser/driver`)
      .set(authorization)
      .send({ driver: "human" })
      .expect(404);
  });

  it("requires auth", async () => {
    await request(app).get(`/api/v1/bots/${botId}/browser`).expect(401);
  });
});
