/**
 * Browser routes (issue #24): status, start, VNC ticket, resize, driver and
 * profile reset — against the app's express stack with a live fake session
 * injected into the toolkit's session map (the same seam the production
 * toolkit uses).
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
  createBrowserToolkit,
  getLiveBrowserSession,
  resetBrowserSessionsForTests,
  type BrowserSession,
  type BrowserVnc,
} from "../../../packages/agent/src/toolkits/browser";
import {
  redeemVncTicket,
  resetVncTicketsForTests,
} from "../../../apps/web/src/server/api/bots/browser.vnc";

const token = generateToken({ userId: 1, email: "browser-test@example.com" });
const authorization = { Authorization: `Bearer ${token}` };

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerRoutes(app);
  app.use(errorHandlerMiddleware);
  return app;
}

function fakeSession(options: { vnc?: boolean } = {}) {
  const resizes: { width: number; height: number }[] = [];
  const wipes: string[] = [];
  let driver: "agent" | "human" = "agent";
  const vnc: BrowserVnc | undefined = options.vnc
    ? {
        scale: 2,
        openStream: async () => {
          throw new Error("not used by the route tests");
        },
        resize: async (width, height) => {
          resizes.push({ width, height });
        },
      }
    : undefined;
  const session: BrowserSession = {
    vnc,
    wipeProfile: async () => {
      wipes.push("wipe");
    },
    url: () => "https://example.com/page",
    navigate: async () => ({ url: "https://example.com/page", status: 200 }),
    snapshot: async () => "- body [ref=e1]",
    click: async () => ({ url: "https://example.com/page" }),
    type: async () => ({ url: "https://example.com/page" }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    close: async () => {},
  };
  return {
    session,
    resizes,
    wipes,
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

  // Installs the fake as the live session for this bot (headless or VNC).
  async function openFake(options: { vnc?: boolean } = {}) {
    resetBrowserSessionsForTests();
    fake = fakeSession(options);
    await acquire(
      { transport: async () => fake.session, profilesDir: "/tmp/ta-route-profiles" },
      conversationId,
    );
  }

  beforeEach(async () => {
    await prisma.bot.deleteMany();
    const response = await request(app)
      .post("/api/v1/bots")
      .set(authorization)
      .send({ name: "B", modelId: "m", systemPrompt: "" })
      .expect(201);
    botId = response.body.data.id;
    conversationId = Number(response.body.data.conversationId);
    resetVncTicketsForTests();
    await openFake();
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
    expect(r.body.data).toEqual({
      active: false,
      url: null,
      driver: null,
      mode: null,
      scale: null,
      starting: false,
      phase: null,
      error: null,
    });
  });

  it("reports a headless session as having no live view", async () => {
    const r = await request(app)
      .get(`/api/v1/bots/${botId}/browser`)
      .set(authorization)
      .expect(200);
    expect(r.body.data).toMatchObject({
      active: true,
      url: "https://example.com/page",
      driver: "agent",
      mode: "headless",
      scale: null,
    });
  });

  it("reports a VNC session with its pixel density", async () => {
    await openFake({ vnc: true });
    const r = await request(app)
      .get(`/api/v1/bots/${botId}/browser`)
      .set(authorization)
      .expect(200);
    expect(r.body.data).toMatchObject({ active: true, mode: "vnc", scale: 2 });
  });

  it("starts the browser on request and reports it live", async () => {
    resetBrowserSessionsForTests();
    const next = fakeSession({ vnc: true });
    createBrowserToolkit({
      transport: async () => next.session,
      profilesDir: "/tmp/ta-route-profiles",
    });
    const r = await request(app)
      .post(`/api/v1/bots/${botId}/browser/start`)
      .set(authorization)
      .expect(200);
    expect(r.body.data).toEqual({ starting: true });
    await vi.waitFor(() => expect(getLiveBrowserSession(conversationId)).toBeDefined());
    expect(getLiveBrowserSession(conversationId)?.session).toBe(next.session);
  });

  it("surfaces why a requested start failed", async () => {
    resetBrowserSessionsForTests();
    createBrowserToolkit({
      transport: async () => {
        throw new Error("VM exec failed: no sudo");
      },
      profilesDir: "/tmp/ta-route-profiles",
    });
    await request(app).post(`/api/v1/bots/${botId}/browser/start`).set(authorization).expect(200);
    await vi.waitFor(async () => {
      const r = await request(app).get(`/api/v1/bots/${botId}/browser`).set(authorization);
      expect(r.body.data.error).toContain("no sudo");
      expect(r.body.data.starting).toBe(false);
    });
  });

  it("mints a one-time VNC ticket bound to this bot", async () => {
    await openFake({ vnc: true });
    const r = await request(app)
      .post(`/api/v1/bots/${botId}/browser/vnc-ticket`)
      .set(authorization)
      .expect(200);
    expect(r.body.data.scale).toBe(2);
    const url = new URL(r.body.data.path, "http://internal");
    expect(url.pathname).toBe(`/api/v1/bots/${botId}/browser/vnc`);
    const ticket = url.searchParams.get("ticket")!;
    expect(ticket.length).toBeGreaterThan(20);

    expect(redeemVncTicket(ticket, "some-other-bot")).toBeUndefined(); // wrong bot burns it
    expect(redeemVncTicket(ticket, botId)).toBeUndefined();

    const again = await request(app)
      .post(`/api/v1/bots/${botId}/browser/vnc-ticket`)
      .set(authorization)
      .expect(200);
    const second = new URL(again.body.data.path, "http://internal").searchParams.get("ticket")!;
    expect(second).not.toBe(ticket);
    expect(redeemVncTicket(second, botId)).toMatchObject({ botId, conversationId });
    expect(redeemVncTicket(second, botId)).toBeUndefined(); // single use
  });

  it("refuses a VNC ticket without a VNC browser or a session", async () => {
    await request(app)
      .post(`/api/v1/bots/${botId}/browser/vnc-ticket`)
      .set(authorization)
      .expect(409);
    resetBrowserSessionsForTests();
    await request(app)
      .post(`/api/v1/bots/${botId}/browser/vnc-ticket`)
      .set(authorization)
      .expect(404);
  });

  it("fits the browser window to the viewer", async () => {
    await openFake({ vnc: true });
    const r = await request(app)
      .post(`/api/v1/bots/${botId}/browser/resize`)
      .set(authorization)
      .send({ width: 900, height: 700 })
      .expect(200);
    expect(r.body.data).toEqual({ width: 900, height: 700 });
    expect(fake.resizes).toEqual([{ width: 900, height: 700 }]);
  });

  it("rejects absurd or non-VNC resizes", async () => {
    await openFake({ vnc: true });
    for (const size of [
      { width: 10, height: 700 },
      { width: 900, height: 99999 },
      { width: 900.5, height: 700 },
      { width: 900 },
    ]) {
      await request(app)
        .post(`/api/v1/bots/${botId}/browser/resize`)
        .set(authorization)
        .send(size)
        .expect(400);
    }
    expect(fake.resizes).toEqual([]);

    await openFake();
    await request(app)
      .post(`/api/v1/bots/${botId}/browser/resize`)
      .set(authorization)
      .send({ width: 900, height: 700 })
      .expect(409);
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
    expect(getLiveBrowserSession(conversationId)?.driver).toBe("agent");
  });

  it("404s driver flip when no session exists", async () => {
    resetBrowserSessionsForTests();
    await request(app)
      .post(`/api/v1/bots/${botId}/browser/driver`)
      .set(authorization)
      .send({ driver: "human" })
      .expect(404);
  });

  it("resets the profile: closes the session and wipes it", async () => {
    await request(app)
      .delete(`/api/v1/bots/${botId}/browser/profile`)
      .set(authorization)
      .expect(200);
    expect(getLiveBrowserSession(conversationId)).toBeUndefined();
    expect(fake.wipes).toEqual(["wipe"]);
  });

  it("requires auth", async () => {
    await request(app).get(`/api/v1/bots/${botId}/browser`).expect(401);
    await request(app).post(`/api/v1/bots/${botId}/browser/vnc-ticket`).expect(401);
    await request(app).post(`/api/v1/bots/${botId}/browser/start`).expect(401);
  });
});
