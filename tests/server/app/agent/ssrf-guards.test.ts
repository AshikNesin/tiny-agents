/**
 * S7 (behavior register): the SSRF guards. `checkPublicUrl` classifies IP
 * literals as addresses (CGNAT and every IPv6 form that embeds an IPv4
 * included) and names as names; the browser checks every main-frame request
 * of an agent's tab and its popups before it is sent, for the tab's whole
 * life, and resolves names; `http_request` resolves a host once and
 * connects only to the addresses it checked.
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { chromium, type Browser, type Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { VaultBroker } from "../../../../packages/agent/src/vault";
import {
  createWebToolkit,
  pinnedFetch,
  type PinnedFetch,
} from "../../../../packages/agent/src/toolkits/web";
import { pageSession } from "../../../../packages/sandbox/src/browser-chromium";
import {
  navigationGuard,
  refusesNavigation,
} from "../../../../packages/sandbox/src/navigation-guard";
import { checkPublicUrl, isPrivateAddress } from "../../../../packages/sandbox/src/public-url";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/**
 * A server on 127.0.0.1 that records the pages it was asked for (not the
 * favicon a browser fetches on its own after a page loads).
 */
async function serve(
  handler: (path: string) => { status?: number; headers?: Record<string, string>; body?: string },
) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    if (req.url !== "/favicon.ico") hits.push(req.url ?? "");
    const reply = handler(req.url ?? "");
    res.writeHead(reply.status ?? 200, reply.headers);
    res.end(reply.body ?? "");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { hits, port: (server.address() as AddressInfo).port };
}

describe("checkPublicUrl and isPrivateAddress (S7a)", () => {
  const refused = (url: string) => expect(() => checkPublicUrl(url), url).toThrow(/Private/);
  const allowed = (url: string) => expect(checkPublicUrl(url).href, url).toBe(new URL(url).href);

  it("refuses CGNAT (100.64.0.0/10) literals", () => {
    refused("http://100.64.0.1/");
    refused("http://100.127.255.254/");
    allowed("http://100.63.255.255/");
    allowed("http://100.128.0.1/");
    expect(isPrivateAddress("100.100.100.100")).toBe(true);
  });

  it("refuses IPv4-mapped IPv6 literals of private addresses, dotted or hex", () => {
    refused("http://[::ffff:127.0.0.1]/");
    refused("http://[::ffff:10.0.0.1]/");
    refused("http://[::ffff:7f00:1]/");
    refused("http://[::ffff:a9fe:a9fe]/latest/meta-data/"); // 169.254.169.254
    refused("http://[0:0:0:0:0:ffff:6440:1]/"); // 100.64.0.1
    allowed("http://[::ffff:5db8:d822]/"); // 93.184.216.34
    expect(isPrivateAddress("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateAddress("::ffff:c0a8:101")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateAddress("::ffff:808:808")).toBe(false);
  });

  it("still refuses the other private literals and local names", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://0x7f.1/",
      "http://2130706433/",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://192.168.1.4/",
      "http://169.254.169.254/",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[::]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://localhost:3000/",
      "http://localhost./",
      "http://app.localhost/",
      "http://printer.local/",
      "http://metadata.google.internal/",
    ]) {
      refused(url);
    }
    allowed("http://[2606:4700::1111]/");
    allowed("https://example.com/");
  });

  it("refuses IPv6 forms that embed a private IPv4, and site-local and multicast IPv6", () => {
    refused("http://[::127.0.0.1]/"); // IPv4-compatible, parsed to [::7f00:1]
    refused("http://[::7f00:1]/");
    refused("http://[64:ff9b::7f00:1]/"); // NAT64
    refused("http://[64:ff9b::a9fe:a9fe]/");
    refused("http://[64:ff9b:1::a00:1]/"); // local-use NAT64
    refused("http://[2002:7f00:1::]/"); // 6to4
    refused("http://[2002:a9fe:a9fe::1]/");
    refused("http://[::ffff:0:7f00:1]/"); // SIIT
    refused("http://[fec0::1]/"); // site-local
    refused("http://[ff02::1]/"); // multicast
    allowed("http://[64:ff9b::808:808]/"); // NAT64 of 8.8.8.8
    allowed("http://[2002:808:808::1]/"); // 6to4 of 8.8.8.8
    expect(isPrivateAddress("::ffff:0:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("fe80::1%eth0")).toBe(true);
    expect(isPrivateAddress("2002:c0a8:101::")).toBe(true);
  });

  it("refuses the benchmarking, IETF and documentation IPv4 ranges", () => {
    refused("http://198.18.0.1/");
    refused("http://198.19.255.254/");
    refused("http://192.0.0.8/");
    refused("http://192.0.2.1/");
    allowed("http://198.20.0.1/");
    allowed("http://192.0.1.1/");
  });

  it("classifies a name as a name, however it starts", () => {
    allowed("https://10.example.com/");
    allowed("https://127.example.com/");
    allowed("https://192.168.example.com/");
    allowed("https://172.16.example.com/");
    allowed("https://0.example.com/");
    allowed("https://fd00.example.com/");
  });
});

// ── The browser's navigation guard (S7b) ────────────────────────────────

const open = { viewportWidth: 1280, viewportHeight: 800 };

/**
 * A browser as the guard sees it: one browser-level DevTools session whose
 * `Fetch` pauses each tab's main-frame document requests (a request only
 * goes out once it is continued) and whose `Target` events name popups.
 */
function fakeChrome() {
  const sent: string[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const answers = new Map<string, (method: string) => void>();
  let id = 0;
  const cdp = {
    send: async (_method: string, params?: { requestId?: string }) => {
      if (params?.requestId) answers.get(params.requestId)?.(_method);
      return {};
    },
    on: (event: string, handler: (event: unknown) => void) => void listeners.set(event, handler),
  };
  const browser = { newBrowserCDPSession: async () => cdp } as unknown as Browser;

  /** Tab `frameId` asks for `url`: whether the request went out. */
  async function request(frameId: string, url: string): Promise<boolean> {
    const requestId = `r${++id}`;
    const answer = new Promise<string>((resolve) => answers.set(requestId, resolve));
    listeners.get("Fetch.requestPaused")?.({
      requestId,
      frameId,
      resourceType: "Document",
      request: { url },
    });
    const went = (await answer) === "Fetch.continueRequest";
    if (went) sent.push(url);
    return went;
  }

  /**
   * A tab whose `goto` follows `redirects`, each hop asked of the guard. Its
   * DevTools methods in `silent` never answer (a busy renderer answers no
   * `Page.*` call; the browser process answers `Target.*`).
   */
  function tab(
    frameId: string,
    redirects: Record<string, string> = {},
    silent: string[] = ["Page.getFrameTree"],
  ): Page {
    let current = "about:blank";
    const page = {
      once: () => undefined,
      context: () => ({
        newCDPSession: async () => ({
          send: (method: string) =>
            silent.includes(method)
              ? new Promise(() => undefined)
              : Promise.resolve({
                  frameTree: { frame: { id: frameId } },
                  targetInfo: { targetId: frameId, type: "page" },
                }),
          detach: async () => undefined,
        }),
      }),
      keyboard: { press: async () => undefined },
      url: () => current,
      waitForLoadState: async () => undefined,
      title: async () => "",
      // Enter starts no navigation here: the waits for one time out at once.
      mainFrame: () => ({}),
      waitForRequest: () => Promise.reject(new Error("Timeout")),
      waitForEvent: () => Promise.reject(new Error("Timeout")),
      goto: async (start: string) => {
        const chain: string[] = [];
        for (let url: string | undefined = start; url; url = redirects[url]) {
          if (url !== "about:blank" && !(await request(frameId, url))) {
            throw new Error(`page.goto: net::ERR_BLOCKED_BY_CLIENT at ${start}`);
          }
          chain.push(url);
          current = url;
        }
        const hop = (i: number): unknown =>
          i < 0 ? null : { url: () => chain[i], redirectedFrom: () => hop(i - 1) };
        return { status: () => 200, headers: () => ({}), request: () => hop(chain.length - 1) };
      },
    };
    return page as unknown as Page;
  }

  /** Tab `openerId` opened a popup, `targetId`. */
  const popup = (openerId: string, targetId: string) =>
    listeners.get("Target.targetCreated")?.({
      targetInfo: { targetId, openerId, type: "page", url: "" },
    });
  return { browser, tab, request, popup, sent };
}

/** Names the fake DNS knows: nip.io-style names answer the address they spell. */
const fakeDns = async (host: string) =>
  host.endsWith(".nip.io")
    ? [host.slice(0, -".nip.io".length)]
    : host === "nas.lan"
      ? ["192.168.1.10"]
      : ["93.184.216.34"];
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("refusesNavigation's name checks (S7b)", () => {
  const exempt = (...hosts: string[]) => new Set(hosts);

  it("lets a name through when the private address it resolves to is exempt", async () => {
    expect(await refusesNavigation("http://nas.lan/", exempt("192.168.1.10"), fakeDns)).toBe(false);
    expect(await refusesNavigation("http://nas.lan/", exempt(), fakeDns)).toBe(true);
  });

  it("matches an exempt name written with a trailing dot", async () => {
    expect(await refusesNavigation("http://nas.lan./", exempt("nas.lan"), fakeDns)).toBe(false);
    expect(await refusesNavigation("http://nas.lan./", exempt(), fakeDns)).toBe(true);
  });

  it("without a resolver (the VM transport) checks literals and local names only", async () => {
    expect(await refusesNavigation("http://127.0.0.1.nip.io/", exempt(), null)).toBe(false);
    expect(await refusesNavigation("http://router/", exempt(), null)).toBe(false);
    expect(await refusesNavigation("http://127.0.0.1/", exempt(), null)).toBe(true);
    expect(await refusesNavigation("http://localhost/", exempt(), null)).toBe(true);
  });

  it("leaves a name whose lookup takes too long to the browser", async () => {
    const started = Date.now();
    const stuck = () => new Promise<string[]>(() => undefined);
    expect(await refusesNavigation("http://slow.example/", exempt(), stuck)).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 15_000);
});

describe("browser navigation guard (S7b)", () => {
  it("refuses a redirect hop to a private address before its request is sent", async () => {
    const chrome = fakeChrome();
    const guard = await navigationGuard(chrome.browser, { resolveHost: fakeDns });
    const page = chrome.tab("tab-1", {
      "https://public.example/start": "https://public.example/next",
      "https://public.example/next": "http://127.0.0.1:8080/admin",
    });
    const session = pageSession(page, open, { close: async () => {}, guard });
    await expect(session.navigate("https://public.example/start")).rejects.toThrow(
      "Blocked: the page redirected to a private address (127.0.0.1:8080).",
    );
    expect(chrome.sent).toEqual(["https://public.example/start", "https://public.example/next"]);
    expect(page.url()).toBe("about:blank");
  });

  it("lets a redirect to an exempt private host through", async () => {
    const chrome = fakeChrome();
    const guard = await navigationGuard(chrome.browser, { resolveHost: fakeDns });
    const page = chrome.tab("tab-1", { "https://public.example/": "http://localhost:3000/" });
    const session = pageSession(
      page,
      { ...open, allowedPrivateHosts: "localhost" },
      { close: async () => {}, guard },
    );
    expect(await session.navigate("https://public.example/")).toEqual({
      url: "http://localhost:3000/",
      status: 200,
    });
    expect(chrome.sent).toEqual(["https://public.example/", "http://localhost:3000/"]);
  });

  it("refuses a name that resolves to a private address, as the URL or as a hop", async () => {
    const chrome = fakeChrome();
    const guard = await navigationGuard(chrome.browser, { resolveHost: fakeDns });
    const page = chrome.tab("tab-1", {
      "https://public.example/": "https://10.1.2.3.nip.io/",
    });
    const session = pageSession(page, open, { close: async () => {}, guard });
    await expect(session.navigate("https://127.0.0.1.nip.io/")).rejects.toThrow(
      "Private and local addresses can't be fetched.",
    );
    await expect(session.navigate("https://public.example/")).rejects.toThrow(
      "Blocked: the page redirected to a private address (10.1.2.3.nip.io).",
    );
    expect(chrome.sent).toEqual(["https://public.example/"]);
    expect(await refusesNavigation("https://8.8.8.8.nip.io/", new Set(), fakeDns)).toBe(false);
  });

  it("keeps guarding the tab after navigate: the page's own navigations and its popups", async () => {
    const chrome = fakeChrome();
    const guard = await navigationGuard(chrome.browser, { resolveHost: fakeDns });
    const session = pageSession(chrome.tab("tab-1"), open, { close: async () => {}, guard });
    await session.navigate("https://public.example/");
    // A meta refresh, `location = …` or a click later: a main-frame request of the tab.
    expect(await chrome.request("tab-1", "http://127.0.0.1:8080/admin")).toBe(false);
    expect(await chrome.request("tab-1", "https://public.example/next")).toBe(true);
    // `window.open` from the tab: the popup inherits the guard.
    chrome.popup("tab-1", "popup-1");
    expect(await chrome.request("popup-1", "http://169.254.169.254/latest/meta-data/")).toBe(false);
    chrome.popup("popup-1", "popup-2");
    expect(await chrome.request("popup-2", "http://10.0.0.1/")).toBe(false);
    // A tab no agent holds (the owner's own) is not guarded.
    expect(await chrome.request("owner-tab", "http://127.0.0.1:8080/router")).toBe(true);
  });

  it("lets a tab through again once no agent holds it, and guards it again when one does", async () => {
    const chrome = fakeChrome();
    const guard = await navigationGuard(chrome.browser, { resolveHost: fakeDns });
    const session = pageSession(chrome.tab("tab-1"), open, { close: async () => {}, guard });
    await session.navigate("https://public.example/");
    chrome.popup("tab-1", "popup-1");
    expect(await chrome.request("tab-1", "http://192.168.1.1/")).toBe(false);
    // Let go of (closeTab blanks the browser's first tab and releases it): the owner's LAN pages load.
    session.release?.();
    await settle(0);
    expect(await chrome.request("tab-1", "http://192.168.1.1/")).toBe(true);
    expect(await chrome.request("popup-1", "http://192.168.1.1/")).toBe(true);
    // An agent acts on it again: guarded again.
    await session.press("Enter");
    expect(await chrome.request("tab-1", "http://192.168.1.1/")).toBe(false);
  });

  it("asks the browser process, not the renderer, for the tab's frame (a busy page can't hang it)", async () => {
    const chrome = fakeChrome();
    const guard = await navigationGuard(chrome.browser, { resolveHost: fakeDns });
    // `Page.getFrameTree` never answers, as on a renderer stuck in a loop.
    const session = pageSession(chrome.tab("busy-1"), open, { close: async () => {}, guard });
    expect(await session.navigate("https://public.example/")).toMatchObject({ status: 200 });
    expect(await chrome.request("busy-1", "http://127.0.0.1/")).toBe(false);
  });

  it("fails the action with a clear error when the browser doesn't answer at all", async () => {
    const chrome = fakeChrome();
    const guard = await navigationGuard(chrome.browser, { resolveHost: fakeDns });
    const page = chrome.tab("gone-1", {}, ["Page.getFrameTree", "Target.getTargetInfo"]);
    const session = pageSession(page, open, { close: async () => {}, guard });
    await expect(session.press("Enter")).rejects.toThrow(/not responding/);
    await expect(session.navigate("https://public.example/")).rejects.toThrow(/not responding/);
    expect(chrome.sent).toEqual([]);
  }, 20_000);

  it("refuses to navigate without a guard", async () => {
    const chrome = fakeChrome();
    const session = pageSession(chrome.tab("tab-1"), open, { close: async () => {} });
    await expect(session.navigate("https://public.example/")).rejects.toThrow(
      "This browser has no navigation guard.",
    );
    expect(chrome.sent).toEqual([]);
  });

  /** A Chromium this machine has, if any (CI may have none). */
  const chromiumPath = [
    chromium.executablePath(),
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find((path) => path && existsSync(path));

  /**
   * A private target on 127.0.0.1 and a site on `localhost` (standing in
   * for a public one: exempt, while 127.0.0.1 is not) whose pages try to
   * reach it.
   */
  async function realChrome() {
    const target = await serve(() => ({ body: "secret" }));
    const T = `http://127.0.0.1:${target.port}`;
    const html = (body: string) => ({ headers: { "content-type": "text/html" }, body });
    const site = await serve((path) => {
      if (path === "/go") return { status: 302, headers: { location: "/hop" } };
      if (path === "/hop") return { status: 302, headers: { location: `${T}/redirect` } };
      if (path === "/meta") return html(`<meta http-equiv="refresh" content="0;url=${T}/meta">hi`);
      if (path === "/script") {
        return html(
          `<script>addEventListener("load", () => setTimeout(() => (location = "${T}/script"), 200))</script>hi`,
        );
      }
      if (path === "/popup") return html(`<script>window.open("${T}/popup")</script>hi`);
      if (path === "/popup-hop") return html(`<script>window.open("/hop")</script>hi`);
      if (path === "/spin-on-load") {
        return html(
          `<title>Busy</title><script>addEventListener("load", () => { for (;;) {} })</script>busy`,
        );
      }
      if (path === "/spin") {
        return html(`<script>setTimeout(() => { for (;;) {} }, 50)</script>spinning`);
      }
      return html("ok");
    });
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
    const guard = await navigationGuard(browser);
    const page = await browser.newPage();
    const session = pageSession(
      page,
      { ...open, allowedPrivateHosts: "localhost" },
      { close: async () => {}, guard },
    );
    const S = `http://localhost:${site.port}`;
    return { browser, page, session, target, site, S };
  }
  it.skipIf(!chromiumPath)(
    "in real Chromium, a page stuck in a loop doesn't hang guarding its tab",
    async () => {
      const { browser, session, S } = await realChrome();
      try {
        await session.navigate(`${S}/spin`);
        const page = await browser.newPage();
        await page.goto(`${S}/spin`);
        await settle(300); // the loop has started
        const guard = await navigationGuard(browser);
        const started = Date.now();
        expect(await guard.watch(page, new Set(["localhost"]))).toEqual(expect.any(String));
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        await browser.close();
      }
    },
    30_000,
  );

  it.skipIf(!chromiumPath)(
    "in real Chromium, navigating to a page that loops once loaded still returns",
    async () => {
      const { browser, session, S } = await realChrome();
      try {
        const started = performance.now();
        const result = await session.navigate(`${S}/spin-on-load`);
        // No title (the renderer never answers), after the 5 s wait for load at most.
        expect(result).toEqual({ url: `${S}/spin-on-load`, status: 200 });
        expect(performance.now() - started).toBeLessThan(10_000);
      } finally {
        await browser.close();
      }
    },
    30_000,
  );

  it.skipIf(!chromiumPath)(
    "in real Chromium, a released tab loads the owner's private pages again",
    async () => {
      const { browser, page, session, target, S } = await realChrome();
      try {
        await session.navigate(`${S}/`);
        await expect(page.goto(`http://127.0.0.1:${target.port}/agent`)).rejects.toThrow();
        session.release?.();
        await settle(100);
        await page.goto(`http://127.0.0.1:${target.port}/owner`);
        expect(target.hits).toEqual(["/owner"]);
      } finally {
        await browser.close();
      }
    },
    30_000,
  );

  it.skipIf(!chromiumPath)(
    "in real Chromium, a public page's redirect to 127.0.0.1 never reaches it",
    async () => {
      const { browser, page, session, target, site, S } = await realChrome();
      try {
        await expect(session.navigate(`${S}/go`)).rejects.toThrow(
          `Blocked: the page redirected to a private address (127.0.0.1:${target.port}).`,
        );
        expect(site.hits).toEqual(["/go", "/hop"]);
        expect(target.hits).toEqual([]);
        expect(page.url()).toBe("about:blank");
        // An exempt page still loads.
        expect(await session.navigate(`${S}/`)).toEqual({ url: `${S}/`, status: 200 });
      } finally {
        await browser.close();
      }
    },
    30_000,
  );

  it.skipIf(!chromiumPath)(
    "in real Chromium, a meta refresh, a script and window.open after the load never reach 127.0.0.1",
    async () => {
      const { browser, page, session, target, S } = await realChrome();
      try {
        for (const path of ["/meta", "/script", "/popup", "/popup-hop"]) {
          await session.navigate(`${S}${path}`).catch(() => undefined);
          await settle(1_000);
        }
        expect(target.hits).toEqual([]);
        // The agent's own tab is not on the private page either.
        expect(page.url()).not.toContain(`127.0.0.1:${target.port}`);
        // The owner's own tab, which no agent holds, is not guarded.
        const owner = await browser.newPage();
        await owner.goto(`http://127.0.0.1:${target.port}/owner`);
        expect(target.hits).toEqual(["/owner"]);
      } finally {
        await browser.close();
      }
    },
    40_000,
  );
});

// ── http_request: one lookup, a pinned connection (S7c) ─────────────────

async function run(web: ReturnType<typeof createWebToolkit>, args: Record<string, unknown>) {
  const tool = web.extension.tools!.find((t) => t.name === "http_request")!;
  const result = (await tool.execute(
    args as never,
    {} as ToolExecutionApi,
    BACKGROUND_CONTEXT,
  )) as ToolExecutionResult;
  const text = (result.output ?? []).map((b) => (b.type === "text" ? b.text : "")).join("");
  return { ...result, text };
}

/** A resolver that answers public the first time and private after: DNS rebinding. */
function rebindingResolver() {
  const lookups: string[] = [];
  return {
    lookups,
    resolveHost: async (host: string) => {
      lookups.push(host);
      return lookups.length === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
    },
  };
}

describe("http_request against DNS rebinding (S7c)", () => {
  it("resolves once and connects only to the address it checked", async () => {
    const dns = rebindingResolver();
    const sends: { url: string; addresses: readonly string[] }[] = [];
    const sendPinned: PinnedFetch = async (url, addresses) => {
      sends.push({ url: url.href, addresses });
      return new Response("hello", { status: 200 });
    };
    const web = createWebToolkit({
      vault: {} as VaultBroker,
      resolveHost: dns.resolveHost,
      sendPinned,
    });
    const result = await run(web, { url: "https://rebind.example/data" });
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain("hello");
    expect(dns.lookups).toEqual(["rebind.example"]);
    expect(sends).toEqual([{ url: "https://rebind.example/data", addresses: ["93.184.216.34"] }]);
  });

  it("refuses a redirect hop whose fresh lookup turns private", async () => {
    const dns = rebindingResolver();
    const sends: string[] = [];
    const sendPinned: PinnedFetch = async (url) => {
      sends.push(url.href);
      return new Response(null, { status: 302, headers: { location: "/again" } });
    };
    const web = createWebToolkit({
      vault: {} as VaultBroker,
      resolveHost: dns.resolveHost,
      sendPinned,
    });
    const result = await run(web, { url: "https://rebind.example/" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe("Blocked redirect: Private and local addresses can't be requested.");
    expect(sends).toEqual(["https://rebind.example/"]);
  });

  it("refuses a name whose answer holds a private address next to public ones", async () => {
    const sends: string[] = [];
    const web = createWebToolkit({
      vault: {} as VaultBroker,
      resolveHost: async () => ["93.184.216.34", "64:ff9b::7f00:1"],
      sendPinned: async (url) => {
        sends.push(url.href);
        return new Response("no");
      },
    });
    const result = await run(web, { url: "https://mixed.example/" });
    expect(result.text).toBe("Private and local addresses can't be requested.");
    expect(sends).toEqual([]);
  });

  it("lets go of each redirect's body, the last one included", async () => {
    const cancelled: string[] = [];
    const sendPinned: PinnedFetch = async (url) => {
      const body = new ReadableStream<Uint8Array>({
        cancel: () => void cancelled.push(url.pathname),
      });
      return new Response(body, { status: 302, headers: { location: `${url.pathname}x` } });
    };
    const web = createWebToolkit({
      vault: {} as VaultBroker,
      resolveHost: async () => ["93.184.216.34"],
      sendPinned,
    });
    const result = await run(web, { url: "https://loop.example/a" });
    expect(result.text).toBe("Too many redirects.");
    expect(cancelled).toEqual(["/a", "/ax", "/axx", "/axxx", "/axxxx", "/axxxxx"]);
  });

  it("connects to the pinned address, never to what DNS says for the name", async () => {
    const body = "pinned ".repeat(50_000); // streams on after the response's headers
    const server = await serve(() => ({ body }));
    // `rebind.invalid` resolves nowhere: only the pin can reach the server.
    const response = await pinnedFetch(
      new URL(`http://rebind.invalid:${server.port}/x`),
      ["127.0.0.1"],
      { method: "GET" },
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toBe(body);
    expect(server.hits).toEqual(["/x"]);

    // `localhost` resolves to the server, but the pin (another loopback address) wins.
    await expect(
      pinnedFetch(new URL(`http://localhost:${server.port}/y`), ["127.0.0.3"], { method: "GET" }),
    ).rejects.toThrow();
    expect(server.hits).toEqual(["/x"]);
  });
});
