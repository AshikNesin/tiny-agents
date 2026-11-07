/**
 * Computer routes (issue #108): status, start, VNC ticket, driver (and the
 * takeover hand-back) and reset, against the app's Hono stack with a fake
 * desktop manager injected through the same seam the toolkit uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, createTestApp } from "../helpers";
import { authToken } from "../fixtures";
import { db, bots } from "../../../apps/web/src/server/db";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { setComputerSessionsForTests } from "../../../apps/web/src/server/api/bots/computer.sessions";
import { settleBotReleases } from "../../../apps/web/src/server/api/bots/bot-resources";
import { resetComputerVncTicketsForTests } from "../../../apps/web/src/server/api/bots/computer.vnc";
import {
  createComputerSessions,
  type ComputerSessions,
} from "../../../packages/agent/src/toolkits/computer";
import { fakeComputer, type FakeComputer } from "../app/agent/computer-fakes";

const token = await authToken("computer-test@example.com");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data varies per route
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
  catalog: {
    has: vi.fn(() => true),
    list: vi.fn(() => [
      { id: "m", name: "M", family: "other", reasoning: false, contextWindow: 8192, vision: false },
    ]),
    info: vi.fn(() => undefined),
  },
  busyConversations: vi.fn(() => []),
  listCapabilities: vi.fn(() => []),
};

describe("computer routes", () => {
  const app = createTestApp();
  const call = (path: string, init: { method?: string; json?: unknown } = {}) =>
    api<Data>(app, path, { ...init, token });
  let botId: string;
  let fake: FakeComputer;
  let sessions: ComputerSessions;

  beforeEach(async () => {
    setAgentRuntimeForTests(agentRuntime as never);
    fake = fakeComputer();
    sessions = createComputerSessions({ transport: fake.transport, width: 1280, height: 800 });
    setComputerSessionsForTests(sessions);
    resetComputerVncTicketsForTests();
    await db.delete(bots);
    const response = await call("/api/v1/bots", {
      method: "POST",
      json: { name: "B", modelId: "m", systemPrompt: "" },
    });
    expect(response.status).toBe(201);
    botId = response.body.data.id;
  });

  afterEach(async () => {
    await sessions.closeAll();
    setComputerSessionsForTests(undefined);
    await db.delete(bots);
  });

  it("deleting a bot closes and wipes its own desktop", async () => {
    const own = await call("/api/v1/bots", {
      method: "POST",
      json: { name: "Own", modelId: "m", systemPrompt: "", browserProfile: "own" },
    });
    expect(own.status).toBe(201);
    const ownId: string = own.body.data.id;
    const profile = `bot-${ownId}`;
    await sessions.acquire(profile);
    const close = vi.spyOn(sessions, "close");
    expect((await call(`/api/v1/bots/${ownId}`, { method: "DELETE" })).status).toBe(200);
    await settleBotReleases();
    expect(close).toHaveBeenCalledWith(profile, { wipe: true });
    expect(sessions.get(profile)).toBeUndefined();
  });

  it("deleting a bot on the shared desktop leaves that desktop to the others", async () => {
    await sessions.acquire("shared");
    expect((await call(`/api/v1/bots/${botId}`, { method: "DELETE" })).status).toBe(200);
    await settleBotReleases();
    expect(sessions.get("shared")).toBeDefined();
    expect(fake.wiped).not.toContain("shared");
  });

  it("says why there is no computer without a sandbox VM", async () => {
    setComputerSessionsForTests(null);
    const status = await call(`/api/v1/bots/${botId}/computer`);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ configured: false, active: false });
    expect(status.body.data.setupHint).toMatch(/SANDBOX_HOST/);
    const start = await call(`/api/v1/bots/${botId}/computer/start`, { method: "POST" });
    expect(start.status).toBe(409);
  });

  it("starts the bot's desktop on the shared profile and reports it live", async () => {
    const before = await call(`/api/v1/bots/${botId}/computer`);
    expect(before.body.data).toMatchObject({
      configured: true,
      active: false,
      profile: "shared",
      width: 1280,
      height: 800,
    });
    const start = await call(`/api/v1/bots/${botId}/computer/start`, { method: "POST" });
    expect(start.status).toBe(200);
    await vi.waitFor(() => expect(sessions.get("shared")).toBeDefined());
    const after = await call(`/api/v1/bots/${botId}/computer`);
    expect(after.body.data).toMatchObject({ active: true, driver: "agent", takeover: null });
    expect(fake.opened).toEqual(["shared"]);
  });

  it("reports an open failure until the next start", async () => {
    fake.failNextOpen("Could not install the desktop stack on the VM");
    await call(`/api/v1/bots/${botId}/computer/start`, { method: "POST" });
    await vi.waitFor(async () => {
      const status = await call(`/api/v1/bots/${botId}/computer`);
      expect(status.body.data.error).toMatch(/desktop stack/);
    });
  });

  it("mints a viewer ticket only for a live desktop", async () => {
    const none = await call(`/api/v1/bots/${botId}/computer/vnc-ticket`, { method: "POST" });
    expect(none.status).toBe(404);
    await sessions.acquire("shared");
    const ticket = await call(`/api/v1/bots/${botId}/computer/vnc-ticket`, { method: "POST" });
    expect(ticket.status).toBe(200);
    expect(ticket.body.data.path).toMatch(
      new RegExp(`^/api/v1/bots/${botId}/computer/vnc\\?ticket=[\\w-]+$`),
    );
    expect(ticket.body.data.scale).toBe(1);
  });

  it("hands the desktop to the owner and back, answering a takeover request", async () => {
    await sessions.acquire("shared");
    const request = sessions.requestTakeover("shared", "Sign in to the mail app", 60_000);
    await vi.waitFor(() => expect(sessions.get("shared")?.driver).toBe("human"));
    const status = await call(`/api/v1/bots/${botId}/computer`);
    expect(status.body.data).toMatchObject({
      driver: "human",
      takeover: "Sign in to the mail app",
    });
    const back = await call(`/api/v1/bots/${botId}/computer/driver`, {
      method: "POST",
      json: { driver: "agent" },
    });
    expect(back.status).toBe(200);
    expect(await request).toBe("released");
    expect(sessions.get("shared")?.driver).toBe("agent");
  });

  it("resets the desktop: closes it and wipes its profile on the VM", async () => {
    await sessions.acquire("shared");
    const reset = await call(`/api/v1/bots/${botId}/computer/profile`, { method: "DELETE" });
    expect(reset.status).toBe(200);
    expect(sessions.get("shared")).toBeUndefined();
    expect(fake.wiped).toEqual(["shared"]);
  });

  it("uses the bot's own desktop when it has its own browser profile", async () => {
    await db.update(bots).set({ browserProfile: "own" });
    await call(`/api/v1/bots/${botId}/computer/start`, { method: "POST" });
    await vi.waitFor(() => expect(fake.opened).toEqual([`bot-${botId}`]));
    const status = await call(`/api/v1/bots/${botId}/computer`);
    expect(status.body.data).toMatchObject({ profile: "own", active: true });
  });
});
