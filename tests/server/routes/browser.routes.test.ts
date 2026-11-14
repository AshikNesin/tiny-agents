/**
 * Browser routes (issue #24): status, start, VNC ticket, resize, driver and
 * profile reset — against the app's Hono stack with a live fake session
 * injected into the toolkit's session map (the same seam the production
 * toolkit uses).
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { fakeCatalog, fakeModel, useTestRuntime } from "../fixtures";
import { api, createTestApp } from "../helpers";
import { db, bots } from "../../../apps/web/src/server/db";
import { vi } from "vite-plus/test";
import {
  createBrowserSessions,
  type BrowserSessions,
  type BrowserSessionsOptions,
  type BrowserSession,
  type BrowserTarget,
  type BrowserTransport,
  type BrowserVnc,
} from "../../../packages/agent/src/toolkits/browser";
import type { OpenBrowserOptions } from "../../../packages/sandbox/src/browser-sessions";
import { setBrowserSessionsForTests } from "../../../apps/web/src/server/api/bots/browser.sessions";

/**
 * The manager the routes act through. One per test; `install` swaps the
 * transport its next open uses (the way a test used to swap the toolkit's),
 * so browsers already live stay live across an install.
 */
let sessions: BrowserSessions | undefined;
let currentTransport: BrowserTransport = async () => fakeSession().session;
let wipedDirs: string[] = [];
function freshManager(): BrowserSessions {
  wipedDirs = [];
  sessions = createBrowserSessions({
    profilesDir: "/tmp/ta-route-profiles",
    transport: Object.assign(
      (dir: string, open: OpenBrowserOptions) => currentTransport(dir, open),
      {
        wipe: async (dir: string) => {
          wipedDirs.push(dir);
        },
      },
    ),
  });
  setBrowserSessionsForTests(sessions);
  return sessions;
}
function install(options: Pick<BrowserSessionsOptions, "transport" | "profilesDir">) {
  currentTransport = options.transport!;
  return sessions ?? freshManager();
}
const getLiveBrowserSession = (target: BrowserTarget) => sessions?.get(target);
/** Nothing live, nothing opening: the routes see no browser. */
async function resetBrowserSessionsForTests() {
  await sessions?.closeAll();
}
import {
  redeemVncTicket,
  resetVncTicketsForTests,
} from "../../../apps/web/src/server/api/bots/browser.vnc";

const token = await authToken("browser-test@example.com");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response data varies per route
type Data = any;

/** A JSON request through the app, authenticated unless `anonymous`. */
function call(
  app: ReturnType<typeof createTestApp>,
  path: string,
  init: { method?: string; json?: unknown; anonymous?: boolean } = {},
) {
  const { anonymous, ...rest } = init;
  return api<Data>(app, path, { ...rest, ...(anonymous ? {} : { token }) });
}

function fakeSession(options: { vnc?: boolean; resizeError?: string } = {}) {
  const resizes: { width: number; height: number }[] = [];
  const disconnects: (() => void)[] = [];
  let driver: "agent" | "human" = "agent";
  const vnc: BrowserVnc | undefined = options.vnc
    ? {
        scale: 2,
        openStream: async () => {
          throw new Error("not used by the route tests");
        },
        resize: async (width, height) => {
          if (options.resizeError) throw new Error(options.resizeError);
          resizes.push({ width, height });
        },
      }
    : undefined;
  const session: BrowserSession = {
    vnc,
    onDisconnect: (listener) => {
      disconnects.push(listener);
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
    /** The browser dies under the app (a dropped link, Chrome exiting). */
    die: () => disconnects.forEach((listener) => listener()),
    get driver() {
      return driver;
    },
  };
}

import { authToken } from "../fixtures";

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

describe("browser routes", () => {
  beforeEach(() => {
    useTestRuntime(agentRuntime as never);
  });
  const app = createTestApp();
  const get = (path: string) => call(app, path);
  const post = (path: string, json?: unknown) => call(app, path, { method: "POST", json });
  let botId: string;
  /** New bots use the shared browser profile, in a tab of their own. */
  let target: { profile: string; tab: string };
  let fake: ReturnType<typeof fakeSession>;

  // Installs the fake as the live session for this bot (headless or VNC).
  async function openFake(options: { vnc?: boolean; resizeError?: string } = {}) {
    await sessions?.closeAll();
    fake = fakeSession(options);
    await install({ transport: async () => fake.session }).acquire(target);
  }

  beforeEach(async () => {
    await db.delete(bots);
    const response = await post("/api/v1/bots", { name: "B", modelId: "m", systemPrompt: "" });
    expect(response.status).toBe(201);
    botId = response.body.data.id;
    target = { profile: "shared", tab: botId };
    resetVncTicketsForTests();
    await openFake();
  });

  afterEach(async () => {
    await sessions?.closeAll();
    sessions = undefined;
    setBrowserSessionsForTests(undefined);
    await db.delete(bots);
  });

  it("reports inactive status when no session exists", async () => {
    await resetBrowserSessionsForTests();
    const r = await get(`/api/v1/bots/${botId}/browser`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      active: false,
      profile: "shared",
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
    const r = await get(`/api/v1/bots/${botId}/browser`);
    expect(r.status).toBe(200);
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
    const r = await get(`/api/v1/bots/${botId}/browser`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ active: true, mode: "vnc", scale: 2 });
  });

  it("starts the browser on request and reports it live", async () => {
    await resetBrowserSessionsForTests();
    const next = fakeSession({ vnc: true });
    install({
      transport: async () => next.session,
      profilesDir: "/tmp/ta-route-profiles",
    });
    const r = await post(`/api/v1/bots/${botId}/browser/start`);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ starting: true });
    await vi.waitFor(() => expect(getLiveBrowserSession(target)).toBeDefined());
    expect(getLiveBrowserSession(target)?.session).toBe(next.session);
  });

  it("surfaces why a requested start failed", async () => {
    await resetBrowserSessionsForTests();
    install({
      transport: async () => {
        throw new Error("VM exec failed: no sudo");
      },
      profilesDir: "/tmp/ta-route-profiles",
    });
    expect((await post(`/api/v1/bots/${botId}/browser/start`)).status).toBe(200);
    await vi.waitFor(async () => {
      const r = await get(`/api/v1/bots/${botId}/browser`);
      expect(r.body.data.error).toContain("no sudo");
      expect(r.body.data.starting).toBe(false);
    });
  });

  it("mints a one-time VNC ticket bound to this bot", async () => {
    await openFake({ vnc: true });
    const r = await post(`/api/v1/bots/${botId}/browser/vnc-ticket`);
    expect(r.status).toBe(200);
    expect(r.body.data.scale).toBe(2);
    const url = new URL(r.body.data.path, "http://internal");
    expect(url.pathname).toBe(`/api/v1/bots/${botId}/browser/vnc`);
    const ticket = url.searchParams.get("ticket")!;
    expect(ticket.length).toBeGreaterThan(20);

    expect(redeemVncTicket(ticket, "some-other-bot")).toBeUndefined(); // wrong bot burns it
    expect(redeemVncTicket(ticket, botId)).toBeUndefined();

    const again = await post(`/api/v1/bots/${botId}/browser/vnc-ticket`);
    expect(again.status).toBe(200);
    const second = new URL(again.body.data.path, "http://internal").searchParams.get("ticket")!;
    expect(second).not.toBe(ticket);
    expect(redeemVncTicket(second, botId)).toMatchObject({ botId, target });
    expect(redeemVncTicket(second, botId)).toBeUndefined(); // single use
  });

  it("refuses a VNC ticket without a VNC browser or a session", async () => {
    expect((await post(`/api/v1/bots/${botId}/browser/vnc-ticket`)).status).toBe(409);
    await resetBrowserSessionsForTests();
    expect((await post(`/api/v1/bots/${botId}/browser/vnc-ticket`)).status).toBe(404);
  });

  it("fits the browser window to the viewer", async () => {
    await openFake({ vnc: true });
    const r = await post(`/api/v1/bots/${botId}/browser/resize`, { width: 900, height: 700 });
    expect(r.status).toBe(200);
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
      expect((await post(`/api/v1/bots/${botId}/browser/resize`, size)).status).toBe(400);
    }
    expect(fake.resizes).toEqual([]);

    await openFake();
    const headless = await post(`/api/v1/bots/${botId}/browser/resize`, {
      width: 900,
      height: 700,
    });
    expect(headless.status).toBe(409);
  });

  it("answers 502 instead of pretending when the window cannot be resized", async () => {
    await openFake({ vnc: true, resizeError: "Resizing the browser timed out after 10s" });
    const r = await post(`/api/v1/bots/${botId}/browser/resize`, { width: 900, height: 700 });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).toContain("timed out");
  });

  it("reports a browser that died as closed instead of live", async () => {
    await openFake({ vnc: true });
    expect((await get(`/api/v1/bots/${botId}/browser`)).status).toBe(200);
    fake.die();

    const status = await get(`/api/v1/bots/${botId}/browser`);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ active: false, mode: null, driver: null });
    // Nothing is left to resize or drive: the panel offers to open a new one.
    const gone = await post(`/api/v1/bots/${botId}/browser/resize`, { width: 900, height: 700 });
    expect(gone.status).toBe(404);
    expect(fake.resizes).toEqual([]);
  });

  it("flips the driver and back", async () => {
    const take = await post(`/api/v1/bots/${botId}/browser/driver`, { driver: "human" });
    expect(take.status).toBe(200);
    expect(take.body.data.driver).toBe("human");
    expect(getLiveBrowserSession(target)?.driver).toBe("human");
    const release = await post(`/api/v1/bots/${botId}/browser/driver`, { driver: "agent" });
    expect(release.status).toBe(200);
    expect(release.body.data.driver).toBe("agent");
    expect(getLiveBrowserSession(target)?.driver).toBe("agent");
  });

  it("404s driver flip when no session exists", async () => {
    await resetBrowserSessionsForTests();
    expect((await post(`/api/v1/bots/${botId}/browser/driver`, { driver: "human" })).status).toBe(
      404,
    );
  });

  it("resets the profile: closes the session and wipes it", async () => {
    const reset = await call(app, `/api/v1/bots/${botId}/browser/profile`, { method: "DELETE" });
    expect(reset.status).toBe(200);
    expect(getLiveBrowserSession(target)).toBeUndefined();
    expect(wipedDirs).toEqual(["/tmp/ta-route-profiles/shared"]);
  });

  it("gives bots on the shared profile one browser, each with its own tab", async () => {
    await resetBrowserSessionsForTests();
    const tabs: string[] = [];
    const tab = (url: string): BrowserSession => ({ ...fakeSession().session, url: () => url });
    const browser: BrowserSession = {
      ...fakeSession({ vnc: true }).session,
      url: () => "https://first.example/",
      openTab: async () => {
        tabs.push("opened");
        return tab("about:blank");
      },
    };
    let launches = 0;
    install({
      transport: async () => {
        launches += 1;
        return browser;
      },
      profilesDir: "/tmp/ta-route-profiles",
    });
    const second = await post("/api/v1/bots", { name: "C", modelId: "m", systemPrompt: "" });
    expect(second.status).toBe(201);
    const otherId: string = second.body.data.id;

    for (const id of [botId, otherId]) {
      expect((await post(`/api/v1/bots/${id}/browser/start`)).status).toBe(200);
      await vi.waitFor(() => expect(getLiveBrowserSession(target)?.tabs.has(id)).toBe(true));
    }
    expect(launches).toBe(1);
    expect(tabs).toEqual(["opened"]);
    const first = await get(`/api/v1/bots/${botId}/browser`);
    const other = await get(`/api/v1/bots/${otherId}/browser`);
    expect(first.body.data).toMatchObject({
      active: true,
      profile: "shared",
      url: "https://first.example/",
    });
    expect(other.body.data).toMatchObject({ active: true, profile: "shared", url: "about:blank" });
  });

  it("gives a bot set to its own profile a browser of its own", async () => {
    const patched = await call(app, `/api/v1/bots/${botId}`, {
      method: "PATCH",
      json: { browserProfile: "own" },
    });
    expect(patched.status).toBe(200);
    const own = { profile: `bot-${botId}`, tab: botId };
    const ownFake = fakeSession();
    install({
      transport: async () => ownFake.session,
      profilesDir: "/tmp/ta-route-profiles",
    });

    const before = await get(`/api/v1/bots/${botId}/browser`);
    expect(before.body.data).toMatchObject({ active: false, profile: "own" });
    expect((await post(`/api/v1/bots/${botId}/browser/start`)).status).toBe(200);
    await vi.waitFor(() => expect(getLiveBrowserSession(own)?.session).toBe(ownFake.session));

    // Resetting it wipes only its own profile; the shared browser stays up.
    const reset = await call(app, `/api/v1/bots/${botId}/browser/profile`, { method: "DELETE" });
    expect(reset.status).toBe(200);
    expect(wipedDirs).toEqual([`/tmp/ta-route-profiles/bot-${botId}`]);
    expect(getLiveBrowserSession(own)).toBeUndefined();
    expect(getLiveBrowserSession(target)).toBeDefined();
  });

  it("requires auth", async () => {
    const anonymous = (path: string, method = "POST") =>
      call(app, path, { method, anonymous: true });
    expect((await anonymous(`/api/v1/bots/${botId}/browser`, "GET")).status).toBe(401);
    expect((await anonymous(`/api/v1/bots/${botId}/browser/vnc-ticket`)).status).toBe(401);
    expect((await anonymous(`/api/v1/bots/${botId}/browser/start`)).status).toBe(401);
  });
});
