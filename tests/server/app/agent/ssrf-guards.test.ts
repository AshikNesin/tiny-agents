/**
 * S7 (behavior register): the SSRF guards. `checkPublicUrl` classifies IP
 * literals as addresses (CGNAT and IPv4-mapped IPv6 included) and names as
 * names; the browser checks each hop of a navigation before its request is
 * sent; `http_request` resolves a host once and connects only to the
 * addresses it checked.
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { chromium, type Page } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { VaultBroker } from "../../../../packages/agent/src/vault";
import {
  createWebToolkit,
  pinnedFetch,
  type PinnedFetch,
} from "../../../../packages/agent/src/toolkits/web";
import { pageSession } from "../../../../packages/sandbox/src/browser-chromium";
import { checkPublicUrl, isPrivateAddress } from "../../../../packages/sandbox/src/public-url";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A server on 127.0.0.1 that records the paths it was asked for. */
async function serve(
  handler: (path: string) => { status?: number; headers?: Record<string, string>; body?: string },
) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
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
 * A page whose `goto` follows `redirects` and asks the DevTools Fetch domain
 * about each hop, as Chromium does: a hop is only sent once it is continued.
 */
function fakeChromePage(redirects: Record<string, string>) {
  const sent: string[] = [];
  const answers = new Map<string, (method: string) => void>();
  let onPaused: ((event: unknown) => void) | undefined;
  let intercepting = false;
  let current = "about:blank";
  let id = 0;
  const cdp = {
    send: async (method: string, params?: { requestId?: string }) => {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "main" } } };
      if (method === "Fetch.enable") intercepting = true;
      if (method === "Fetch.disable") intercepting = false;
      if (params?.requestId) answers.get(params.requestId)?.(method);
      return {};
    },
    on: (event: string, handler: (event: unknown) => void) => {
      if (event === "Fetch.requestPaused") onPaused = handler;
    },
    detach: async () => undefined,
  };
  const page = {
    once: () => undefined,
    context: () => ({ newCDPSession: async () => cdp }),
    url: () => current,
    goto: async (start: string) => {
      const chain: string[] = [];
      for (let url: string | undefined = start; url; url = redirects[url]) {
        if (intercepting && onPaused) {
          const requestId = `r${++id}`;
          const answer = new Promise<string>((resolve) => answers.set(requestId, resolve));
          onPaused({ requestId, frameId: "main", resourceType: "Document", request: { url } });
          if ((await answer) === "Fetch.failRequest") {
            throw new Error(`page.goto: net::ERR_BLOCKED_BY_CLIENT at ${start}`);
          }
        }
        sent.push(url);
        chain.push(url);
        current = url;
      }
      const request = (i: number): unknown =>
        i < 0 ? null : { url: () => chain[i], redirectedFrom: () => request(i - 1) };
      return { status: () => 200, request: () => request(chain.length - 1) };
    },
  };
  return { page: page as unknown as Page, sent };
}

describe("browser navigation guard (S7b)", () => {
  it("refuses a redirect hop to a private address before its request is sent", async () => {
    const { page, sent } = fakeChromePage({
      "https://public.example/start": "https://public.example/next",
      "https://public.example/next": "http://127.0.0.1:8080/admin",
    });
    const session = pageSession(page, open, { close: async () => {} });
    await expect(session.navigate("https://public.example/start")).rejects.toThrow(
      "Blocked: the page redirected to a private address (127.0.0.1:8080).",
    );
    expect(sent).toEqual([
      "https://public.example/start",
      "https://public.example/next",
      "about:blank",
    ]);
  });

  it("lets a redirect to an exempt private host through", async () => {
    const { page, sent } = fakeChromePage({ "https://public.example/": "http://localhost:3000/" });
    const session = pageSession(
      page,
      { ...open, allowedPrivateHosts: "localhost" },
      {
        close: async () => {},
      },
    );
    expect(await session.navigate("https://public.example/")).toEqual({
      url: "http://localhost:3000/",
      status: 200,
    });
    expect(sent).toEqual(["https://public.example/", "http://localhost:3000/"]);
  });

  /** A Chromium this machine has, if any (CI may have none). */
  const chromiumPath = [
    chromium.executablePath(),
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find((path) => path && existsSync(path));

  it.skipIf(!chromiumPath)(
    "in real Chromium, a public page's redirect to 127.0.0.1 never reaches it",
    async () => {
      const target = await serve(() => ({ body: "secret" }));
      const site = await serve((path) =>
        path === "/go"
          ? { status: 302, headers: { location: "/hop" } }
          : path === "/hop"
            ? { status: 302, headers: { location: `http://127.0.0.1:${target.port}/admin` } }
            : { body: "ok" },
      );
      const browser = await chromium.launch({
        executablePath: chromiumPath,
        args: ["--no-sandbox"],
      });
      try {
        const page = await browser.newPage();
        // `localhost` stands in for a public site: exempt, while 127.0.0.1 is not.
        const session = pageSession(
          page,
          { ...open, allowedPrivateHosts: "localhost" },
          {
            close: async () => {},
          },
        );
        await expect(session.navigate(`http://localhost:${site.port}/go`)).rejects.toThrow(
          `Blocked: the page redirected to a private address (127.0.0.1:${target.port}).`,
        );
        expect(site.hits).toEqual(["/go", "/hop"]);
        expect(target.hits).toEqual([]);
        expect(page.url()).toBe("about:blank");

        // The guard is off once the navigation is over: an exempt page loads as before.
        expect(await session.navigate(`http://localhost:${site.port}/`)).toEqual({
          url: `http://localhost:${site.port}/`,
          status: 200,
        });
      } finally {
        await browser.close();
      }
    },
    30_000,
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
