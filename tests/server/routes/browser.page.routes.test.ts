/**
 * The Browser page's routes (issue #160): browsers by profile (the shared
 * one and one per own-profile bot), start on the owner's own tab, viewer
 * tickets, resize, driving without moving any bot's tab, reset, and
 * refusing profiles no bot has, against the app's Hono stack with a fake
 * browser transport.
 */
import { eq } from "drizzle-orm";
import { fakeCatalog, fakeModel } from "../fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, createTestApp } from "../helpers";
import { authToken } from "../fixtures";
import { db, bots } from "../../../apps/web/src/server/db";
import { setAgentRuntimeForTests } from "../../../apps/web/src/server/api/bots/bots.runtime";
import { setBrowserSessionsForTests } from "../../../apps/web/src/server/api/bots/browser.sessions";
import {
  redeemBrowserPageVncTicket,
  resetVncTicketsForTests,
} from "../../../apps/web/src/server/api/bots/browser.vnc";
import {
  createBrowserSessions,
  type BrowserSession,
  type BrowserSessions,
} from "../../../packages/agent/src/toolkits/browser";

const token = await authToken("browser-page@example.com");

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
  catalog: fakeCatalog([fakeModel("m", { name: "M" })]),
  busyConversations: vi.fn(() => []),
  listCapabilities: vi.fn(() => []),
};

interface FakeTab {
  name: string;
  adopted: number;
}

/** A browser with a tab per `openTab`, a VNC display and a log of what happened. */
function fakeBrowser(options: { vnc?: boolean } = {}) {
  const resizes: { width: number; height: number }[] = [];
  const opened: string[] = [];
  const tabs: FakeTab[] = [];
  const page = (name: string): BrowserSession & { fake: FakeTab } => {
    const fake: FakeTab = { name, adopted: 0 };
    tabs.push(fake);
    return {
      fake,
      url: () => `https://example.com/${name}`,
      navigate: async () => ({ url: "https://example.com/", status: 200 }),
      snapshot: async () => "- body [ref=e1]",
      click: async () => ({ url: "https://example.com/" }),
      type: async () => ({ url: "https://example.com/" }),
      press: async () => {},
      scroll: async () => {},
      screenshot: async () => ({ data: "" }),
      close: async () => {},
      adoptActiveTab: async () => {
        fake.adopted += 1;
      },
      focus: async () => {},
    } as BrowserSession & { fake: FakeTab };
  };
  const first = page("first");
  const session: BrowserSession = {
    ...first,
    vnc:
      options.vnc === false
        ? undefined
        : {
            scale: 2,
            openStream: async () => {
              throw new Error("not used by the route tests");
            },
            resize: async (width, height) => {
              resizes.push({ width, height });
            },
          },
    onDisconnect: () => {},
    openTab: async () => page(`tab-${tabs.length}`),
  };
  return {
    transport: async (dir: string) => {
      opened.push(dir.split("/").pop()!);
      return session;
    },
    resizes,
    opened,
    tabs,
  };
}

describe("browser page routes", () => {
  const app = createTestApp();
  const call = (path: string, init: { method?: string; json?: unknown } = {}) =>
    api<Data>(app, path, { ...init, token });
  let fake: ReturnType<typeof fakeBrowser>;
  let sessions: BrowserSessions;
  let alpha: string;
  let scout: string;

  const createBot = async (name: string) => {
    const response = await call("/api/v1/bots", {
      method: "POST",
      json: { name, modelId: "m", systemPrompt: "" },
    });
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  };

  const useFake = (next: ReturnType<typeof fakeBrowser>) => {
    fake = next;
    sessions = createBrowserSessions({
      profilesDir: "/tmp/ta-browser-page-profiles",
      transport: (dir) => fake.transport(dir),
    });
    setBrowserSessionsForTests(sessions);
  };

  beforeEach(async () => {
    vi.stubEnv("SANDBOX_HOST", "sandbox.test");
    vi.stubEnv("BROWSER_EXECUTABLE_PATH", "");
    setAgentRuntimeForTests(agentRuntime as never);
    useFake(fakeBrowser());
    resetVncTicketsForTests();
    await db.delete(bots);
    alpha = await createBot("Alpha");
    scout = await createBot("Scout");
    await db.update(bots).set({ browserProfile: "own" }).where(eq(bots.id, scout));
  });

  afterEach(async () => {
    await sessions.closeAll();
    setBrowserSessionsForTests(undefined);
    vi.unstubAllEnvs();
    await db.delete(bots);
  });

  it("lists the shared browser and one per own-profile bot", async () => {
    await sessions.start({ profile: "shared", tab: alpha });
    const res = await call("/api/v1/browser");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ liveView: true, setupHint: null });
    expect(res.body.data.browsers).toEqual([
      expect.objectContaining({
        profile: "shared",
        label: "Shared",
        bots: [{ id: alpha, name: "Alpha" }],
        active: true,
        driver: "agent",
        mode: "vnc",
      }),
      expect.objectContaining({
        profile: `bot-${scout}`,
        label: "Scout",
        bots: [{ id: scout, name: "Scout" }],
        active: false,
        driver: null,
        mode: null,
      }),
    ]);
  });

  it("says why there is no live view without a sandbox VM", async () => {
    vi.stubEnv("SANDBOX_HOST", "");
    const res = await call("/api/v1/browser");
    expect(res.body.data.liveView).toBe(false);
    expect(res.body.data.setupHint).toMatch(/SANDBOX_HOST/);
  });

  it("opens a browser on the owner's own tab, and refuses profiles no bot has", async () => {
    const start = await call(`/api/v1/browser/bot-${scout}/start`, { method: "POST" });
    expect(start.status).toBe(200);
    await vi.waitFor(() =>
      expect(sessions.peek({ profile: `bot-${scout}`, tab: "owner" })).toBeTruthy(),
    );
    expect(fake.opened).toEqual([`bot-${scout}`]);

    for (const profile of [`bot-${alpha}`, "bot-nope", "anything"]) {
      const refused = await call(`/api/v1/browser/${profile}/start`, { method: "POST" });
      expect(refused.status, profile).toBe(404);
    }
  });

  it("mints a profile-scoped viewer ticket for a live browser only", async () => {
    expect((await call("/api/v1/browser/shared/vnc-ticket", { method: "POST" })).status).toBe(404);
    await sessions.start({ profile: "shared", tab: alpha });
    const res = await call("/api/v1/browser/shared/vnc-ticket", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.body.data.scale).toBe(2);
    const ticket = /^\/api\/v1\/browser\/shared\/vnc\?ticket=([\w-]+)$/.exec(
      res.body.data.path,
    )?.[1];
    expect(ticket).toBeTruthy();
    expect(redeemBrowserPageVncTicket(ticket!, `bot-${scout}`)).toBeUndefined();
  });

  it("refuses a ticket for a headless browser", async () => {
    useFake(fakeBrowser({ vnc: false }));
    await sessions.start({ profile: "shared", tab: alpha });
    const res = await call("/api/v1/browser/shared/vnc-ticket", { method: "POST" });
    expect(res.status).toBe(409);
    const list = await call("/api/v1/browser");
    expect(list.body.data.browsers[0].mode).toBe("headless");
  });

  it("fits the browser window to the page", async () => {
    await sessions.start({ profile: "shared", tab: alpha });
    const res = await call("/api/v1/browser/shared/resize", {
      method: "POST",
      json: { width: 1200, height: 800 },
    });
    expect(res.status).toBe(200);
    expect(fake.resizes).toEqual([{ width: 1200, height: 800 }]);
    const tooSmall = await call("/api/v1/browser/shared/resize", {
      method: "POST",
      json: { width: 10, height: 10 },
    });
    expect(tooSmall.status).toBe(400);
  });

  it("hands back from the page without moving any bot's tab", async () => {
    const botTarget = { profile: "shared", tab: alpha };
    await sessions.start(botTarget);
    await call("/api/v1/browser/shared/start", { method: "POST" });
    await vi.waitFor(() => expect(sessions.peek({ profile: "shared", tab: "owner" })).toBeTruthy());

    const take = await call("/api/v1/browser/shared/driver", {
      method: "POST",
      json: { driver: "human" },
    });
    expect(take.status).toBe(200);
    expect(sessions.get(botTarget)?.driver).toBe("human");

    await call("/api/v1/browser/shared/driver", { method: "POST", json: { driver: "agent" } });
    expect(sessions.get(botTarget)?.driver).toBe("agent");
    // The owner's tab adopted the tab in front; the bot's tab stayed put.
    const botTab = sessions.peek(botTarget)!.session as unknown as { fake: FakeTab };
    const ownerTab = sessions.peek({ profile: "shared", tab: "owner" })!.session as unknown as {
      fake: FakeTab;
    };
    expect(botTab.fake.adopted).toBe(0);
    expect(ownerTab.fake.adopted).toBe(1);
  });

  it("resets a browser: closes it and wipes its profile", async () => {
    await sessions.start({ profile: `bot-${scout}`, tab: scout });
    const res = await call(`/api/v1/browser/bot-${scout}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(sessions.get({ profile: `bot-${scout}`, tab: scout })).toBeUndefined();
  });
});
