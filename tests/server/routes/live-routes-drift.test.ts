import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { authToken, fakeCatalog, fakeModel, useTestRuntime } from "../fixtures";
import { api, createTestApp } from "../helpers";
import { db, bots, users } from "../../../apps/web/src/server/db";
import { setBrowserSessionsForTests } from "../../../apps/web/src/server/api/bots/browser.sessions";
import { setComputerSessionsForTests } from "../../../apps/web/src/server/api/bots/computer.sessions";
import {
  redeemBrowserPageVncTicket,
  redeemVncTicket,
  resetVncTicketsForTests,
} from "../../../apps/web/src/server/api/bots/browser.vnc";
import { resetComputerVncTicketsForTests } from "../../../apps/web/src/server/api/bots/computer.vnc";
import {
  createBrowserSessions,
  type BrowserSession,
  type BrowserSessions,
} from "../../../packages/agent/src/toolkits/browser";
import {
  createComputerSessions,
  type ComputerSessions,
} from "../../../packages/agent/src/toolkits/computer";
import { fakeComputer, type FakeComputer } from "../app/agent/computer-fakes";

const OWNER_ID = 990_401;
const token = await authToken("live-drift-owner@example.com", OWNER_ID);

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

const app = createTestApp();
const call = (path: string, init: { method?: string; json?: unknown; token?: string } = {}) =>
  api<Data>(app, path, { token, ...init });
const post = (path: string, json?: unknown, as = token) =>
  call(path, { method: "POST", json, token: as });
const del = (path: string) => call(path, { method: "DELETE" });

const refused = (code: string, message: string) => ({
  success: false,
  error: expect.objectContaining({ code, message }),
});

function exact(actual: unknown, expected: unknown) {
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

const UNKNOWN_BOT = "00000000-0000-4000-8000-000000000000";
const now = () => Date.now();

function fakeBrowser(options: { vnc?: boolean; resize?: () => Promise<void> } = {}) {
  const opened: string[] = [];
  const page = (url: string): BrowserSession => ({
    url: () => url,
    navigate: async () => ({ url, status: 200 }),
    snapshot: async () => "- body [ref=e1]",
    click: async () => ({ url }),
    type: async () => ({ url }),
    press: async () => {},
    scroll: async () => {},
    screenshot: async () => ({ data: "" }),
    close: async () => {},
    adoptActiveTab: async () => {},
    focus: async () => {},
  });
  const session: BrowserSession = {
    ...page("https://example.com/first"),
    vnc:
      options.vnc === false
        ? undefined
        : {
            scale: 2,
            openStream: async () => {
              throw new Error("not used");
            },
            resize: options.resize ?? (async () => {}),
          },
    onDisconnect: () => {},
    openTab: async () => page("about:blank"),
  };
  return {
    opened,
    session,
    transport: async (dir: string) => {
      opened.push(dir.split("/").pop()!);
      return session;
    },
  };
}

beforeEach(async () => {
  useTestRuntime(agentRuntime as never);
  resetVncTicketsForTests();
  resetComputerVncTicketsForTests();
  await db.delete(bots);
});

afterEach(async () => {
  setBrowserSessionsForTests(undefined);
  setComputerSessionsForTests(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await db.delete(bots);
});

async function createBot(name: string, extra: Record<string, unknown> = {}) {
  const response = await post("/api/v1/bots", { name, modelId: "m", systemPrompt: "", ...extra });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function ownBot(name: string) {
  const id = await createBot(name);
  await db.update(bots).set({ browserProfile: "own" }).where(eq(bots.id, id));
  return id;
}

describe("the live routes the app mounts", () => {
  it("is exactly these methods and paths", () => {
    const live = createTestApp()
      .routes.filter((route) => route.method !== "ALL")
      .map((route) => `${route.method} ${route.path}`)
      .filter((route) => /\/(browser|computer)(\/|$)/.test(route))
      .sort();
    expect(live).toEqual([
      "DELETE /api/v1/bots/:id/browser/profile",
      "DELETE /api/v1/bots/:id/computer/profile",
      "DELETE /api/v1/browser/:profile",
      "DELETE /api/v1/computer/:profile",
      "GET /api/v1/bots/:id/browser",
      "GET /api/v1/bots/:id/computer",
      "GET /api/v1/browser",
      "GET /api/v1/computer",
      "GET /api/v1/computer/:profile/apps",
      "POST /api/v1/bots/:id/browser/driver",
      "POST /api/v1/bots/:id/browser/resize",
      "POST /api/v1/bots/:id/browser/start",
      "POST /api/v1/bots/:id/browser/vnc-ticket",
      "POST /api/v1/bots/:id/computer/driver",
      "POST /api/v1/bots/:id/computer/start",
      "POST /api/v1/bots/:id/computer/vnc-ticket",
      "POST /api/v1/browser/:profile/driver",
      "POST /api/v1/browser/:profile/resize",
      "POST /api/v1/browser/:profile/start",
      "POST /api/v1/browser/:profile/vnc-ticket",
      "POST /api/v1/computer/:profile/apps",
      "POST /api/v1/computer/:profile/driver",
      "POST /api/v1/computer/:profile/start",
      "POST /api/v1/computer/:profile/vnc-ticket",
    ]);
  });

  it("has no computer resize route: a 404 for the owner", async () => {
    setComputerSessionsForTests(null);
    const id = await createBot("NoResize");
    const r = await post(`/api/v1/bots/${id}/computer/resize`, { width: 900, height: 700 });
    expect(r.status).toBe(404);
    expect(r.body).toEqual(refused("NOT_FOUND", `Cannot POST /api/v1/bots/${id}/computer/resize`));
  });
});

describe("browser, by bot", () => {
  let sessions: BrowserSessions;
  let fake: ReturnType<typeof fakeBrowser>;
  let id: string;
  const use = (next: ReturnType<typeof fakeBrowser>) => {
    fake = next;
    sessions = createBrowserSessions({
      profilesDir: "/tmp/ta-live-drift",
      transport: (dir) => fake.transport(dir),
    });
    setBrowserSessionsForTests(sessions);
  };

  beforeEach(async () => {
    use(fakeBrowser());
    id = await createBot("Alpha");
  });
  afterEach(() => sessions.closeAll());

  it("answers 404 for a bot that does not exist, on every route", async () => {
    const bot = `/api/v1/bots/${UNKNOWN_BOT}/browser`;
    expect((await call(bot)).body).toEqual(refused("NOT_FOUND", "Bot not found"));
    for (const verb of ["start", "vnc-ticket"]) {
      expect((await post(`${bot}/${verb}`)).body, verb).toEqual(
        refused("NOT_FOUND", "Bot not found"),
      );
    }
    expect((await post(`${bot}/resize`, { width: 900, height: 700 })).status).toBe(404);
    expect((await post(`${bot}/driver`, { driver: "human" })).status).toBe(404);
    expect((await del(`${bot}/profile`)).status).toBe(404);
  });

  it("reads the body before the bot: a bad body wins over an unknown bot", async () => {
    const bot = `/api/v1/bots/${UNKNOWN_BOT}/browser`;
    expect((await post(`${bot}/resize`, { width: 1 })).status).toBe(400);
    expect((await post(`${bot}/driver`, { driver: "nobody" })).status).toBe(400);
  });

  it("reports a live browser with every field, in order", async () => {
    await sessions.start({ profile: "shared", tab: id });
    exact((await call(`/api/v1/bots/${id}/browser`)).body, {
      success: true,
      data: {
        active: true,
        profile: "shared",
        url: "https://example.com/first",
        driver: "agent",
        mode: "vnc",
        scale: 2,
        starting: false,
        phase: null,
        error: null,
      },
    });
    const list = (await call("/api/v1/browser")).body.data.browsers[0];
    expect(Object.keys(list)).toEqual([
      "profile",
      "label",
      "bots",
      "active",
      "driver",
      "mode",
      "starting",
      "phase",
      "error",
    ]);
  });

  it("reports an opening browser as starting", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    sessions = createBrowserSessions({
      profilesDir: "/tmp/ta-live-drift",
      transport: async (dir) => {
        await held;
        return fake.transport(dir);
      },
    });
    setBrowserSessionsForTests(sessions);
    exact((await post(`/api/v1/bots/${id}/browser/start`)).body, {
      success: true,
      data: { starting: true },
    });
    exact((await call(`/api/v1/bots/${id}/browser`)).body, {
      success: true,
      data: {
        active: false,
        profile: "shared",
        url: null,
        driver: null,
        mode: null,
        scale: null,
        starting: true,
        phase: "starting",
        error: null,
      },
    });
    release();
    await vi.waitFor(() => expect(sessions.get({ profile: "shared", tab: id })).toBeDefined());
  });

  it("refuses a ticket with the bot's texts, opens its tab first, and touches the browser", async () => {
    const path = `/api/v1/bots/${id}/browser/vnc-ticket`;
    expect((await post(path)).body).toEqual(
      refused("NOT_FOUND", "No browser session for this bot yet."),
    );
    const other = await createBot("Other");
    await sessions.start({ profile: "shared", tab: other });
    const live = sessions.get({ profile: "shared", tab: id })!;
    expect(live.tabs.has(id)).toBe(false);
    live.lastActivity = 0;
    const r = await post(path);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data)).toEqual(["path", "scale"]);
    expect(live.tabs.has(id)).toBe(true);
    expect(live.lastActivity).toBe(now());
    const ticket = new URL(r.body.data.path, "http://x").searchParams.get("ticket")!;
    expect(redeemVncTicket(ticket, id)).toEqual({
      userId: OWNER_ID,
      botId: id,
      target: { profile: "shared", tab: id },
      viewOnly: false,
    });
  });

  it("refuses a ticket for a headless browser with 409", async () => {
    use(fakeBrowser({ vnc: false }));
    await sessions.start({ profile: "shared", tab: id });
    expect((await post(`/api/v1/bots/${id}/browser/vnc-ticket`)).body).toEqual(
      refused("CONFLICT", "This browser is headless and has no live view."),
    );
  });

  it("refuses resizes with the bot's texts and touches the browser on success", async () => {
    const path = `/api/v1/bots/${id}/browser/resize`;
    const size = { width: 900, height: 700 };
    expect((await post(path, size)).body).toEqual(
      refused("NOT_FOUND", "No browser session for this bot yet."),
    );
    use(fakeBrowser({ vnc: false }));
    await sessions.start({ profile: "shared", tab: id });
    expect((await post(path, size)).body).toEqual(
      refused("CONFLICT", "This browser cannot be resized."),
    );
    await sessions.closeAll();
    let failure: unknown = new Error("xrandr said no");
    use(
      fakeBrowser({
        resize: async () => {
          if (failure) throw failure;
        },
      }),
    );
    await sessions.start({ profile: "shared", tab: id });
    expect((await post(path, size)).body).toEqual(refused("BAD_GATEWAY", "xrandr said no"));
    failure = "a string";
    expect((await post(path, size)).body).toEqual(
      refused("BAD_GATEWAY", "Could not resize the browser."),
    );
    failure = undefined;
    const live = sessions.get({ profile: "shared", tab: id })!;
    live.lastActivity = 0;
    exact((await post(path, size)).body, { success: true, data: size });
    expect(live.lastActivity).toBe(now());
  });

  it("touches the browser when the owner takes over, not when they hand back", async () => {
    await sessions.start({ profile: "shared", tab: id });
    const live = sessions.get({ profile: "shared", tab: id })!;
    live.lastActivity = 0;
    exact((await post(`/api/v1/bots/${id}/browser/driver`, { driver: "human" })).body, {
      success: true,
      data: { driver: "human" },
    });
    expect(live.lastActivity).toBe(now());
    live.lastActivity = 0;
    await post(`/api/v1/bots/${id}/browser/driver`, { driver: "agent" });
    expect(live.lastActivity).toBe(0);
    await sessions.closeAll();
    expect((await post(`/api/v1/bots/${id}/browser/driver`, { driver: "human" })).body).toEqual(
      refused("NOT_FOUND", "No browser session for this bot yet."),
    );
  });

  it("resets with no browser open, and says why a reset failed", async () => {
    exact((await del(`/api/v1/bots/${id}/browser/profile`)).body, {
      success: true,
      data: { reset: true },
    });
    const close = vi.spyOn(sessions, "close").mockRejectedValueOnce(new Error("disk full"));
    expect((await del(`/api/v1/bots/${id}/browser/profile`)).body).toEqual(
      refused("BAD_GATEWAY", "disk full"),
    );
    expect(close).toHaveBeenCalledWith({ profile: "shared", tab: id }, { wipeProfile: true });
    close.mockRejectedValueOnce("nope");
    expect((await del(`/api/v1/bots/${id}/browser/profile`)).body).toEqual(
      refused("BAD_GATEWAY", "Could not reset the browser."),
    );
  });
});

describe("computer, by bot", () => {
  let fake: FakeComputer;
  let sessions: ComputerSessions;
  let id: string;

  beforeEach(async () => {
    fake = fakeComputer();
    sessions = createComputerSessions({ transport: fake.transport, width: 1280, height: 800 });
    setComputerSessionsForTests(sessions);
    id = await createBot("Alpha");
  });
  afterEach(() => sessions.closeAll());

  it("reports the whole status, configured or not", async () => {
    exact((await call(`/api/v1/bots/${id}/computer`)).body, {
      success: true,
      data: {
        configured: true,
        setupHint: null,
        active: false,
        profile: "shared",
        driver: null,
        width: 1280,
        height: 800,
        takeover: null,
        starting: false,
        phase: null,
        error: null,
      },
    });
    setComputerSessionsForTests(null);
    vi.stubEnv("SANDBOX_HOST", "");
    exact((await call(`/api/v1/bots/${id}/computer`)).body, {
      success: true,
      data: {
        configured: false,
        setupHint: "Set SANDBOX_HOST to give bots a computer on the sandbox VM.",
        active: false,
        profile: "shared",
        driver: null,
        width: null,
        height: null,
        takeover: null,
        starting: false,
        phase: null,
        error: null,
      },
    });
  });

  it("reports a live desktop with every field, in order", async () => {
    await sessions.acquire("shared");
    exact((await call(`/api/v1/bots/${id}/computer`)).body, {
      success: true,
      data: {
        configured: true,
        setupHint: null,
        active: true,
        profile: "shared",
        driver: "agent",
        width: 1280,
        height: 800,
        takeover: null,
        starting: false,
        phase: null,
        error: null,
      },
    });
  });

  it("reports an opening desktop as starting", async () => {
    const release = fake.holdOpens();
    await post(`/api/v1/bots/${id}/computer/start`);
    expect((await call(`/api/v1/bots/${id}/computer`)).body.data).toMatchObject({
      active: false,
      starting: true,
      phase: "starting",
      error: null,
    });
    release();
    await vi.waitFor(() => expect(sessions.get("shared")).toBeDefined());
  });

  it("answers 409 with the setup hint without a computer, after the bot lookup", async () => {
    setComputerSessionsForTests(null);
    vi.stubEnv("SANDBOX_HOST", "");
    const hint = refused("CONFLICT", "Set SANDBOX_HOST to give bots a computer on the sandbox VM.");
    const bot = `/api/v1/bots/${id}/computer`;
    expect((await post(`${bot}/start`)).body).toEqual(hint);
    expect((await post(`${bot}/vnc-ticket`)).body).toEqual(hint);
    expect((await post(`${bot}/driver`, { driver: "human" })).body).toEqual(hint);
    expect((await del(`${bot}/profile`)).body).toEqual(hint);
    const unknown = `/api/v1/bots/${UNKNOWN_BOT}/computer`;
    expect((await call(unknown)).body).toEqual(refused("NOT_FOUND", "Bot not found"));
    expect((await post(`${unknown}/start`)).body).toEqual(refused("NOT_FOUND", "Bot not found"));
    expect((await del(`${unknown}/profile`)).body).toEqual(refused("NOT_FOUND", "Bot not found"));
  });

  it("answers 404, not 409, for a live desktop with no live view", async () => {
    await sessions.acquire("shared");
    const live = sessions.get("shared")!;
    delete (live.desktop as { vnc?: unknown }).vnc;
    expect((await post(`/api/v1/bots/${id}/computer/vnc-ticket`)).body).toEqual(
      refused("NOT_FOUND", "No desktop is running for this bot yet."),
    );
  });

  it("mints a bot-scoped ticket and touches the desktop", async () => {
    await sessions.acquire("shared");
    const live = sessions.get("shared")!;
    live.lastActivity = 0;
    const r = await post(`/api/v1/bots/${id}/computer/vnc-ticket`);
    expect(Object.keys(r.body.data)).toEqual(["path", "scale"]);
    expect(live.lastActivity).toBe(now());
  });

  it("refuses the driver with the bot's text; a takeover touches the desktop", async () => {
    expect((await post(`/api/v1/bots/${id}/computer/driver`, { driver: "human" })).body).toEqual(
      refused("NOT_FOUND", "No desktop is running for this bot yet."),
    );
    await sessions.acquire("shared");
    const live = sessions.get("shared")!;
    live.lastActivity = 0;
    exact((await post(`/api/v1/bots/${id}/computer/driver`, { driver: "human" })).body, {
      success: true,
      data: { driver: "human" },
    });
    expect(live.lastActivity).toBe(now());
  });

  it("races the body against the bot lookup for the driver", async () => {
    const bot = `/api/v1/bots/${UNKNOWN_BOT}/computer/driver`;
    expect((await post(bot, { driver: "human" })).status).toBe(404);
    expect((await post(`/api/v1/bots/${id}/computer/driver`, { driver: "nobody" })).status).toBe(
      400,
    );
    expect((await post(bot, { driver: "nobody" })).status).toBe(404);
  });

  it("says why a reset failed", async () => {
    vi.spyOn(sessions, "close").mockRejectedValueOnce(new Error("vm gone"));
    expect((await del(`/api/v1/bots/${id}/computer/profile`)).body).toEqual(
      refused("BAD_GATEWAY", "vm gone"),
    );
    vi.spyOn(sessions, "close").mockRejectedValueOnce(42);
    expect((await del(`/api/v1/bots/${id}/computer/profile`)).body).toEqual(
      refused("BAD_GATEWAY", "Could not reset the computer."),
    );
    exact((await del(`/api/v1/bots/${id}/computer/profile`)).body, {
      success: true,
      data: { reset: true },
    });
  });
});

describe("browser, by profile", () => {
  let sessions: BrowserSessions;
  let fake: ReturnType<typeof fakeBrowser>;
  let alpha: string;
  let scout: string;
  const use = (next: ReturnType<typeof fakeBrowser>) => {
    fake = next;
    sessions = createBrowserSessions({
      profilesDir: "/tmp/ta-live-drift",
      transport: (dir) => fake.transport(dir),
    });
    setBrowserSessionsForTests(sessions);
  };

  beforeEach(async () => {
    vi.stubEnv("SANDBOX_HOST", "sandbox.test");
    vi.stubEnv("BROWSER_EXECUTABLE_PATH", "");
    use(fakeBrowser());
    alpha = await createBot("Alpha");
    scout = await ownBot("Scout");
  });
  afterEach(() => sessions.closeAll());

  it("lists every browser with the same fields", async () => {
    const r = await call("/api/v1/browser");
    exact(r.body, {
      success: true,
      data: {
        liveView: true,
        setupHint: null,
        browsers: [
          {
            profile: "shared",
            label: "Shared",
            bots: [{ id: alpha, name: "Alpha" }],
            active: false,
            driver: null,
            mode: null,
            starting: false,
            phase: null,
            error: null,
          },
          {
            profile: `bot-${scout}`,
            label: "Scout",
            bots: [{ id: scout, name: "Scout" }],
            active: false,
            driver: null,
            mode: null,
            starting: false,
            phase: null,
            error: null,
          },
        ],
      },
    });
  });

  it("answers 404 for a profile no bot has, before anything else", async () => {
    for (const profile of ["anything", `bot-${alpha}`, "bot-nope"]) {
      const base = `/api/v1/browser/${profile}`;
      expect((await post(`${base}/start`)).body, profile).toEqual(
        refused("NOT_FOUND", "No such browser."),
      );
      expect((await post(`${base}/vnc-ticket`)).status).toBe(404);
      expect((await del(base)).status).toBe(404);
    }
  });

  it("races the profile against the body", async () => {
    for (const profile of ["anything", "bot-nope"]) {
      const base = `/api/v1/browser/${profile}`;
      const size = { width: 800, height: 600 };
      expect((await post(`${base}/resize`, size)).status, profile).toBe(404);
      expect((await post(`${base}/driver`, { driver: "human" })).status, profile).toBe(404);
      expect((await post(`${base}/resize`, { width: 1 })).status, profile).toBe(404);
      expect((await post(`${base}/driver`, { driver: "x" })).status, profile).toBe(404);
    }
    expect((await post("/api/v1/browser/shared/resize", { width: 1 })).status).toBe(400);
    expect((await post("/api/v1/browser/shared/driver", { driver: "x" })).status).toBe(400);
  });

  it("refuses a ticket with the page's texts, opens no tab, and mints an owner ticket", async () => {
    const path = "/api/v1/browser/shared/vnc-ticket";
    expect((await post(path)).body).toEqual(refused("NOT_FOUND", "This browser is not running."));
    await sessions.start({ profile: "shared", tab: alpha });
    const live = sessions.get({ profile: "shared", tab: "owner" })!;
    live.lastActivity = 0;
    const r = await post(path);
    expect(Object.keys(r.body.data)).toEqual(["path", "scale"]);
    expect(live.tabs.has("owner")).toBe(false);
    expect(live.lastActivity).toBe(now());
    const ticket = new URL(r.body.data.path, "http://x").searchParams.get("ticket")!;
    expect(redeemBrowserPageVncTicket(ticket, "shared")).toEqual({
      userId: OWNER_ID,
      profile: "shared",
      target: { profile: "shared", tab: "owner" },
    });
  });

  it("refuses resizes and the driver with the page's texts", async () => {
    const size = { width: 900, height: 700 };
    const notRunning = refused("NOT_FOUND", "This browser is not running.");
    expect((await post("/api/v1/browser/shared/resize", size)).body).toEqual(notRunning);
    expect((await post("/api/v1/browser/shared/driver", { driver: "human" })).body).toEqual(
      notRunning,
    );
    use(fakeBrowser({ vnc: false }));
    await sessions.start({ profile: "shared", tab: alpha });
    expect((await post("/api/v1/browser/shared/resize", size)).body).toEqual(
      refused("CONFLICT", "This browser cannot be resized."),
    );
    expect((await post("/api/v1/browser/shared/vnc-ticket")).body).toEqual(
      refused("CONFLICT", "This browser is headless and has no live view."),
    );
    await sessions.closeAll();
    let failure: unknown = new Error("xrandr said no");
    use(
      fakeBrowser({
        resize: async () => {
          if (failure) throw failure;
        },
      }),
    );
    await sessions.start({ profile: "shared", tab: alpha });
    expect((await post("/api/v1/browser/shared/resize", size)).body).toEqual(
      refused("BAD_GATEWAY", "xrandr said no"),
    );
    failure = 7;
    expect((await post("/api/v1/browser/shared/resize", size)).body).toEqual(
      refused("BAD_GATEWAY", "Could not resize the browser."),
    );
    failure = undefined;
    const live = sessions.get({ profile: "shared", tab: "owner" })!;
    live.lastActivity = 0;
    exact((await post("/api/v1/browser/shared/resize", size)).body, {
      success: true,
      data: size,
    });
    expect(live.lastActivity).toBe(now());
    live.lastActivity = 0;
    await post("/api/v1/browser/shared/driver", { driver: "human" });
    expect(live.lastActivity).toBe(now());
    live.lastActivity = 0;
    await post("/api/v1/browser/shared/driver", { driver: "agent" });
    expect(live.lastActivity).toBe(0);
  });

  it("resets with no browser open, and says why a reset failed", async () => {
    exact((await del("/api/v1/browser/shared")).body, {
      success: true,
      data: { reset: true },
    });
    const close = vi.spyOn(sessions, "close").mockRejectedValueOnce(new Error("disk full"));
    expect((await del("/api/v1/browser/shared")).body).toEqual(refused("BAD_GATEWAY", "disk full"));
    expect(close).toHaveBeenCalledWith({ profile: "shared", tab: "owner" }, { wipeProfile: true });
    close.mockRejectedValueOnce(null);
    expect((await del("/api/v1/browser/shared")).body).toEqual(
      refused("BAD_GATEWAY", "Could not reset the browser."),
    );
  });

  it("reports a failed open on the list", async () => {
    sessions = createBrowserSessions({
      profilesDir: "/tmp/ta-live-drift",
      transport: async () => {
        throw new Error("VM exec failed: no sudo");
      },
    });
    setBrowserSessionsForTests(sessions);
    await post("/api/v1/browser/shared/start");
    await vi.waitFor(async () => {
      const shared = (await call("/api/v1/browser")).body.data.browsers[0];
      expect(shared).toMatchObject({ active: false, starting: false, phase: null });
      expect(shared.error).toContain("no sudo");
    });
  });
});

describe("computer, by profile", () => {
  let fake: FakeComputer;
  let sessions: ComputerSessions;
  let alpha: string;
  let scout: string;

  beforeEach(async () => {
    fake = fakeComputer();
    sessions = createComputerSessions({ transport: fake.transport, width: 1280, height: 800 });
    setComputerSessionsForTests(sessions);
    alpha = await createBot("Alpha");
    scout = await ownBot("Scout");
  });
  afterEach(() => sessions.closeAll());

  it("lists every desktop with the same fields, configured or not", async () => {
    const desktops = (fields: Record<string, unknown>) => [
      {
        profile: "shared",
        label: "Shared",
        bots: [{ id: alpha, name: "Alpha" }],
        ...fields,
      },
      {
        profile: `bot-${scout}`,
        label: "Scout",
        bots: [{ id: scout, name: "Scout" }],
        ...fields,
      },
    ];
    const idle = {
      active: false,
      driver: null,
      takeover: null,
      starting: false,
      phase: null,
      error: null,
    };
    exact((await call("/api/v1/computer")).body, {
      success: true,
      data: {
        configured: true,
        setupHint: null,
        width: 1280,
        height: 800,
        desktops: desktops(idle),
      },
    });
    setComputerSessionsForTests(null);
    vi.stubEnv("SANDBOX_HOST", "");
    exact((await call("/api/v1/computer")).body, {
      success: true,
      data: {
        configured: false,
        setupHint: "Set SANDBOX_HOST to give bots a computer on the sandbox VM.",
        width: null,
        height: null,
        desktops: desktops(idle),
      },
    });
  });

  it("answers 404 for a profile no bot has, even without a computer", async () => {
    setComputerSessionsForTests(null);
    vi.stubEnv("SANDBOX_HOST", "");
    for (const profile of ["anything", `bot-${alpha}`, "bot-nope"]) {
      const base = `/api/v1/computer/${profile}`;
      expect((await post(`${base}/start`)).body, profile).toEqual(
        refused("NOT_FOUND", "No such desktop."),
      );
      expect((await post(`${base}/vnc-ticket`)).status).toBe(404);
      expect((await call(`${base}/apps`)).status).toBe(404);
      expect((await del(base)).status).toBe(404);
    }
    const hint = refused("CONFLICT", "Set SANDBOX_HOST to give bots a computer on the sandbox VM.");
    expect((await post("/api/v1/computer/shared/vnc-ticket")).body).toEqual(hint);
    expect((await post("/api/v1/computer/shared/driver", { driver: "human" })).body).toEqual(hint);
    expect((await call("/api/v1/computer/shared/apps")).body).toEqual(hint);
    expect((await post("/api/v1/computer/shared/apps", { id: "x" })).body).toEqual(hint);
    expect((await del("/api/v1/computer/shared")).body).toEqual(hint);
  });

  it("races the profile against the body", async () => {
    for (const profile of ["anything", "bot-nope"]) {
      const base = `/api/v1/computer/${profile}`;
      expect((await post(`${base}/driver`, { driver: "human" })).status, profile).toBe(404);
      expect((await post(`${base}/apps`, { id: "x" })).status, profile).toBe(404);
      expect((await post(`${base}/driver`, { driver: "x" })).status, profile).toBe(404);
      expect((await post(`${base}/apps`, { id: "" })).status, profile).toBe(404);
    }
    expect((await post("/api/v1/computer/shared/driver", { driver: "x" })).status).toBe(400);
    expect((await post("/api/v1/computer/shared/apps", { id: "" })).status).toBe(400);
  });

  it("refuses with the page's texts when nothing runs", async () => {
    const notRunning = refused("NOT_FOUND", "This desktop is not running.");
    expect((await post("/api/v1/computer/shared/vnc-ticket")).body).toEqual(notRunning);
    expect((await post("/api/v1/computer/shared/driver", { driver: "human" })).body).toEqual(
      notRunning,
    );
    expect((await call("/api/v1/computer/shared/apps")).body).toEqual(notRunning);
    expect((await post("/api/v1/computer/shared/apps", { id: "x" })).body).toEqual(notRunning);
  });

  it("answers 409 for a live desktop with no live view, and scale 1 otherwise", async () => {
    await sessions.acquire("shared");
    const live = sessions.get("shared")!;
    const vnc = live.desktop.vnc;
    delete (live.desktop as { vnc?: unknown }).vnc;
    expect((await post("/api/v1/computer/shared/vnc-ticket")).body).toEqual(
      refused("CONFLICT", "This desktop has no live view."),
    );
    Object.assign(live.desktop, { vnc });
    live.lastActivity = 0;
    const r = await post("/api/v1/computer/shared/vnc-ticket");
    expect(r.body.data.scale).toBe(1);
    expect(Object.keys(r.body.data)).toEqual(["path", "scale"]);
    expect(live.lastActivity).toBe(now());
  });

  it("touches the desktop for a takeover and for opening an app", async () => {
    await sessions.acquire("shared");
    const live = sessions.get("shared")!;
    live.lastActivity = 0;
    await post("/api/v1/computer/shared/driver", { driver: "human" });
    expect(live.lastActivity).toBe(now());
    live.lastActivity = 0;
    exact((await post("/api/v1/computer/shared/apps", { id: "org.xfce.mousepad" })).body, {
      success: true,
      data: { opened: "org.xfce.mousepad" },
    });
    expect(live.lastActivity).toBe(now());
  });

  it("says why apps could not be listed or opened, and the owner must drive", async () => {
    await sessions.acquire("shared");
    const live = sessions.get("shared")!;
    expect((await post("/api/v1/computer/shared/apps", { id: "x" })).body).toEqual(
      refused("CONFLICT", "Take control of the desktop first."),
    );
    await sessions.setDriver("shared", "human");
    vi.spyOn(live.desktop, "listApps").mockRejectedValueOnce(new Error("no menu"));
    expect((await call("/api/v1/computer/shared/apps")).body).toEqual(
      refused("BAD_GATEWAY", "no menu"),
    );
    vi.spyOn(live.desktop, "listApps").mockRejectedValueOnce("x");
    expect((await call("/api/v1/computer/shared/apps")).body).toEqual(
      refused("BAD_GATEWAY", "Could not list the apps."),
    );
    vi.spyOn(live.desktop, "openApp").mockRejectedValueOnce(new Error("no such app"));
    expect((await post("/api/v1/computer/shared/apps", { id: "x" })).body).toEqual(
      refused("BAD_GATEWAY", "no such app"),
    );
    vi.spyOn(live.desktop, "openApp").mockRejectedValueOnce(undefined);
    expect((await post("/api/v1/computer/shared/apps", { id: "x" })).body).toEqual(
      refused("BAD_GATEWAY", "Could not open the app."),
    );
  });

  it("says why a reset failed", async () => {
    const close = vi.spyOn(sessions, "close").mockRejectedValueOnce(new Error("vm gone"));
    expect((await del("/api/v1/computer/shared")).body).toEqual(refused("BAD_GATEWAY", "vm gone"));
    expect(close).toHaveBeenCalledWith("shared", { wipe: true });
    close.mockRejectedValueOnce("x");
    expect((await del("/api/v1/computer/shared")).body).toEqual(
      refused("BAD_GATEWAY", "Could not reset the computer."),
    );
  });
});

describe("who stamps a takeover", () => {
  const clock = {
    now: () => 5,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as never),
    setInterval: () => 0,
    clearInterval: () => {},
  };

  it("the browser's routes write the wall clock over the manager's", async () => {
    const fake = fakeBrowser();
    const sessions = createBrowserSessions({
      profilesDir: "/tmp/ta-live-drift",
      transport: fake.transport,
      clock,
    });
    setBrowserSessionsForTests(sessions);
    const id = await createBot("Alpha");
    await sessions.start({ profile: "shared", tab: id });
    const live = sessions.get({ profile: "shared", tab: id })!;
    await post(`/api/v1/bots/${id}/browser/driver`, { driver: "human" });
    expect(live.lastActivity).toBe(now());
    await post(`/api/v1/bots/${id}/browser/driver`, { driver: "agent" });
    live.lastActivity = 0;
    await post("/api/v1/browser/shared/driver", { driver: "human" });
    expect(live.lastActivity).toBe(now());
    await sessions.closeAll();
  });

  it("the computer's routes leave the manager's stamp", async () => {
    const sessions = createComputerSessions({ transport: fakeComputer().transport, clock });
    setComputerSessionsForTests(sessions);
    const id = await createBot("Alpha");
    await sessions.acquire("shared");
    const live = sessions.get("shared")!;
    await post(`/api/v1/bots/${id}/computer/driver`, { driver: "human" });
    expect(live.lastActivity).toBe(5);
    await post(`/api/v1/bots/${id}/computer/driver`, { driver: "agent" });
    live.lastActivity = 0;
    await post("/api/v1/computer/shared/driver", { driver: "human" });
    expect(live.lastActivity).toBe(5);
    await sessions.closeAll();
  });
});

describe("guests on the live routes", () => {
  let browser: BrowserSessions;
  let computer: ComputerSessions;
  let guestToken: string;
  let guestId: number;
  let id: string;

  beforeEach(async () => {
    const fake = fakeBrowser();
    browser = createBrowserSessions({
      profilesDir: "/tmp/ta-live-drift",
      transport: fake.transport,
    });
    setBrowserSessionsForTests(browser);
    computer = createComputerSessions({ transport: fakeComputer().transport });
    setComputerSessionsForTests(computer);
    const email = `live-drift-guest-${Date.now()}@example.com`;
    const added = await post("/api/v1/people", { name: "Priya", email, password: "secret-pass" });
    expect(added.status).toBe(201);
    guestId = added.body.data.id;
    guestToken = await authToken(email, guestId);
    id = await createBot("Shared", { guestIds: [guestId] });
  });
  afterEach(async () => {
    await browser.closeAll();
    await computer.closeAll();
    await call(`/api/v1/people/${guestId}`, { method: "DELETE" });
    await db.delete(users).where(eq(users.id, guestId));
  });

  it("mints watch-only tickets on a shared bot and refuses every profile route", async () => {
    await browser.start({ profile: "shared", tab: id });
    await computer.acquire("shared");
    const b = await post(`/api/v1/bots/${id}/browser/vnc-ticket`, undefined, guestToken);
    const ticket = new URL(b.body.data.path, "http://x").searchParams.get("ticket")!;
    expect(redeemVncTicket(ticket, id)).toMatchObject({ userId: guestId, viewOnly: true });
    const c = await post(`/api/v1/bots/${id}/computer/vnc-ticket`, undefined, guestToken);
    expect(c.status).toBe(200);
    const forbidden = refused("FORBIDDEN", "Only the owner can do that");
    for (const [method, path] of [
      ["GET", "/api/v1/browser"],
      ["GET", "/api/v1/computer"],
      ["POST", "/api/v1/browser/shared/vnc-ticket"],
      ["POST", "/api/v1/computer/shared/vnc-ticket"],
      ["POST", `/api/v1/bots/${id}/browser/start`],
      ["POST", `/api/v1/bots/${id}/computer/driver`],
      ["DELETE", `/api/v1/bots/${id}/browser/profile`],
    ] as const) {
      expect((await call(path, { method, token: guestToken })).body, path).toEqual(forbidden);
    }
    const unshared = await createBot("Mine");
    expect((await call(`/api/v1/bots/${unshared}/browser`, { token: guestToken })).body).toEqual(
      refused("NOT_FOUND", "Bot not found"),
    );
  });
});
