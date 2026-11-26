import { eq } from "drizzle-orm";
import { fakeCatalog, fakeModel, useTestRuntime } from "../fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, createTestApp } from "../helpers";
import { authToken } from "../fixtures";
import { db, bots } from "../../../apps/web/src/server/db";
import { setComputerSessionsForTests } from "../../../apps/web/src/server/api/bots/computer.sessions";
import { resetComputerVncTicketsForTests } from "../../../apps/web/src/server/api/bots/computer.vnc";
import {
  createComputerSessions,
  type ComputerSessions,
} from "../../../packages/agent/src/toolkits/computer";
import { fakeComputer, type FakeComputer } from "../app/agent/computer-fakes";

const token = await authToken("computer-page@example.com");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

const agentRuntime = {
  createConversation: vi
    .fn()
    .mockImplementation(async () => Math.floor(Math.random() * 100000) + 1000),
  configure: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn().mockResolvedValue(undefined),
  abort: vi.fn().mockResolvedValue(undefined),
  watchChat: vi.fn(async () => ({ stop: async () => undefined })),
  onActivity: vi.fn(() => () => undefined),
  isBusy: vi.fn(() => false),
  catalog: fakeCatalog([fakeModel("m", { name: "M" })]),
  busyConversations: vi.fn(() => []),
  listCapabilities: vi.fn(() => []),
};

describe("computer page routes", () => {
  const app = createTestApp();
  const call = (path: string, init: { method?: string; json?: unknown } = {}) =>
    api<Data>(app, path, { ...init, token });
  let fake: FakeComputer;
  let sessions: ComputerSessions;
  let shared: string;
  let loner: string;

  const createBot = async (name: string) => {
    const response = await call("/api/v1/bots", {
      method: "POST",
      json: { name, modelId: "m", systemPrompt: "" },
    });
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  };

  beforeEach(async () => {
    useTestRuntime(agentRuntime as never);
    fake = fakeComputer();
    sessions = createComputerSessions({ transport: fake.transport, width: 1280, height: 800 });
    setComputerSessionsForTests(sessions);
    resetComputerVncTicketsForTests();
    await db.delete(bots);
    shared = await createBot("Alpha");
    loner = await createBot("Scout");
    await db.update(bots).set({ browserProfile: "own" }).where(eq(bots.id, loner));
  });

  afterEach(async () => {
    await sessions.closeAll();
    setComputerSessionsForTests(undefined);
    await db.delete(bots);
  });

  it("lists the shared desktop and one per own-profile bot", async () => {
    await sessions.acquire("shared");
    const res = await call("/api/v1/computer");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ configured: true, width: 1280, height: 800 });
    expect(res.body.data.desktops).toEqual([
      expect.objectContaining({
        profile: "shared",
        label: "Shared",
        bots: [{ id: shared, name: "Alpha" }],
        active: true,
        driver: "agent",
      }),
      expect.objectContaining({
        profile: `bot-${loner}`,
        label: "Scout",
        bots: [{ id: loner, name: "Scout" }],
        active: false,
        driver: null,
      }),
    ]);
  });

  it("says why there is no computer without a sandbox VM", async () => {
    setComputerSessionsForTests(null);
    const res = await call("/api/v1/computer");
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.setupHint).toMatch(/SANDBOX_HOST/);
    const start = await call("/api/v1/computer/shared/start", { method: "POST" });
    expect(start.status).toBe(409);
  });

  it("starts a bot's own desktop and refuses profiles no bot has", async () => {
    const start = await call(`/api/v1/computer/bot-${loner}/start`, { method: "POST" });
    expect(start.status).toBe(200);
    await vi.waitFor(() => expect(fake.opened).toEqual([`bot-${loner}`]));

    for (const profile of [`bot-${shared}`, "bot-nope", "anything"]) {
      const refused = await call(`/api/v1/computer/${profile}/start`, { method: "POST" });
      expect(refused.status, profile).toBe(404);
    }
    expect(fake.opened).toEqual([`bot-${loner}`]);
  });

  it("mints a viewer ticket for a live desktop only", async () => {
    expect((await call("/api/v1/computer/shared/vnc-ticket", { method: "POST" })).status).toBe(404);
    await sessions.acquire("shared");
    const res = await call("/api/v1/computer/shared/vnc-ticket", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.body.data.path).toMatch(/^\/api\/v1\/computer\/shared\/vnc\?ticket=[\w-]+$/);
  });

  it("opens apps only while the owner drives, and hands back to the bots", async () => {
    await sessions.acquire("shared");
    const apps = await call("/api/v1/computer/shared/apps");
    expect(apps.body.data.apps).toEqual([{ id: "org.xfce.mousepad", name: "Mousepad" }]);

    const early = await call("/api/v1/computer/shared/apps", {
      method: "POST",
      json: { id: "org.xfce.mousepad" },
    });
    expect(early.status).toBe(409);

    const take = await call("/api/v1/computer/shared/driver", {
      method: "POST",
      json: { driver: "human" },
    });
    expect(take.status).toBe(200);
    expect(sessions.get("shared")?.driver).toBe("human");
    const opened = await call("/api/v1/computer/shared/apps", {
      method: "POST",
      json: { id: "org.xfce.mousepad" },
    });
    expect(opened.status).toBe(200);
    expect(fake.log.find((e) => e.method === "openApp")?.args).toEqual({ id: "org.xfce.mousepad" });

    await call("/api/v1/computer/shared/driver", { method: "POST", json: { driver: "agent" } });
    expect(sessions.get("shared")?.driver).toBe("agent");
  });

  it("answers a bot's takeover request when the owner releases from the page", async () => {
    await sessions.acquire("shared");
    const request = sessions.requestTakeover("shared", "Sign in to Mail", 60_000);
    await vi.waitFor(() => expect(sessions.get("shared")?.driver).toBe("human"));
    const list = await call("/api/v1/computer");
    expect(list.body.data.desktops[0].takeover).toBe("Sign in to Mail");
    await call("/api/v1/computer/shared/driver", { method: "POST", json: { driver: "agent" } });
    expect(await request).toBe("released");
  });

  it("resets a desktop: closes it and wipes its profile", async () => {
    await sessions.acquire(`bot-${loner}`);
    const res = await call(`/api/v1/computer/bot-${loner}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(sessions.get(`bot-${loner}`)).toBeUndefined();
    expect(fake.wiped).toEqual([`bot-${loner}`]);
  });
});
