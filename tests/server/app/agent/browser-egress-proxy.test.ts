import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createChromiumTransport,
  pageSession,
} from "../../../../packages/sandbox/src/browser-chromium";
import { navigationGuard } from "../../../../packages/sandbox/src/navigation-guard";
import { PROXY_BYPASS_FLAG, startEgressProxy } from "../../../../packages/sandbox/src/egress-proxy";

const chromiumPath = [
  chromium.executablePath(),
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find((path) => path && existsSync(path));

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function serve(body: (path: string) => string, type = "text/plain") {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url !== "/favicon.ico") hits.push(req.url ?? "");
    res.writeHead(200, { "content-type": type, "access-control-allow-origin": "*" });
    res.end(body(req.url ?? ""));
  });
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { hits, port: (server.address() as AddressInfo).port };
}

function flipping(name: string) {
  let calls = 0;
  return async (host: string) => {
    if (host !== name) return ["127.0.0.1"];
    calls += 1;
    return calls === 1 ? ["93.184.216.34"] : ["127.0.0.1"];
  };
}

function rawProxy(proxyUrl: string, request: string): Promise<string> {
  const { hostname, port } = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(port) });
    let reply = "";
    socket.on("data", (chunk) => (reply += chunk.toString("latin1")));
    socket.once("error", reject);
    const timer = setTimeout(() => socket.end(), 1_500);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(reply);
    });
    socket.once("connect", () => socket.write(request));
  });
}

describe("the browser's egress proxy", () => {
  it("refuses a tunnel to a name that resolves to a private address, and to a private literal", async () => {
    const target = await serve(() => "secret");
    const proxy = await startEgressProxy({
      exempt: new Set(),
      resolveHost: async () => ["10.0.0.7"],
    });
    cleanups.push(() => proxy.close());

    const byName = await rawProxy(
      proxy.url,
      "CONNECT inside.test:443 HTTP/1.1\r\nHost: inside.test:443\r\n\r\n",
    );
    expect(byName).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
    expect(byName).toContain("x-tiny-agents-refused: private-address");

    const literal = await rawProxy(
      proxy.url,
      `GET http://127.0.0.1:${target.port}/admin HTTP/1.1\r\nHost: 127.0.0.1:${target.port}\r\nConnection: close\r\n\r\n`,
    );
    expect(literal).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
    expect(literal).toContain("Private and local addresses can't be fetched.");
    expect(target.hits).toEqual([]);
  });

  it("tunnels to an exempt name at the exact address it checked", async () => {
    const target = await serve(() => "inside");
    let lookups = 0;
    const proxy = await startEgressProxy({
      exempt: new Set(["nas.lan"]),
      resolveHost: async () => (++lookups === 1 ? ["127.0.0.1"] : ["192.0.2.1"]),
    });
    cleanups.push(() => proxy.close());

    const reply = await rawProxy(
      proxy.url,
      `CONNECT nas.lan:${target.port} HTTP/1.1\r\n\r\nGET /files HTTP/1.1\r\nHost: nas.lan\r\nConnection: close\r\n\r\n`,
    );
    expect(reply).toMatch(/^HTTP\/1\.1 200 Connection Established\r\n\r\nHTTP\/1\.1 200 OK/);
    expect(reply).toContain("\r\ninside\r\n");
    expect(target.hits).toEqual(["/files"]);
    expect(lookups).toBe(1);
  });
});

describe.skipIf(!chromiumPath)("DNS rebinding in real Chromium (local transport)", () => {
  async function openBrowser(resolveHost: (host: string) => Promise<string[]>, rules: string) {
    const profile = mkdtempSync(join(tmpdir(), "ta-egress-"));
    cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
    const transport = createChromiumTransport({
      executablePath: chromiumPath,
      args: ["--no-sandbox", `--host-resolver-rules=${rules}`],
      resolveHost,
    });
    const session = await transport(profile, {
      viewportWidth: 1280,
      viewportHeight: 800,
      allowedPrivateHosts: "localhost",
    });
    cleanups.push(() => session.close());
    return session;
  }

  it("a name that answers public to the guard and private afterwards never reaches the private host", async () => {
    const target = await serve(() => "secret");
    const session = await openBrowser(flipping("rebind.test"), "MAP rebind.test 127.0.0.1");

    await expect(session.navigate(`http://rebind.test:${target.port}/admin`)).rejects.toThrow(
      "Private and local addresses can't be fetched.",
    );
    expect(target.hits).toEqual([]);
    expect(session.url()).toBe("about:blank");
  }, 30_000);

  it("over https, the refused tunnel never reaches the private host either", async () => {
    const target = await serve(() => "secret");
    const session = await openBrowser(flipping("rebind.test"), "MAP rebind.test 127.0.0.1");

    await expect(session.navigate(`https://rebind.test:${target.port}/admin`)).rejects.toThrow(
      /Private and local addresses can't be fetched\./,
    );
    expect(target.hits).toEqual([]);
  }, 30_000);

  it("a page's own requests to a name that resolves privately are refused too", async () => {
    const target = await serve(() => "secret");
    const site = await serve(
      () =>
        `<title>Public</title><script>fetch("http://inside.test:${target.port}/data").then((r) => r.text()).then((t) => (document.title = t), () => (document.title = "refused"))</script>`,
      "text/html",
    );
    const session = await openBrowser(async () => ["127.0.0.1"], "MAP inside.test 127.0.0.1");

    await session.navigate(`http://localhost:${site.port}/`);
    await expect
      .poll(async () => (await session.tabs?.())?.[0]?.title, { timeout: 5_000 })
      .toBe("refused");
    expect(target.hits).toEqual([]);
  }, 30_000);

  it("where the guard can't resolve names (the VM), a refused tunnel reads as refused, not as a network error", async () => {
    const target = await serve(() => "secret");
    const proxy = await startEgressProxy({
      exempt: new Set(),
      resolveHost: async () => ["10.0.0.7"],
    });
    cleanups.push(() => proxy.close());
    const browser = await chromium.launch({
      executablePath: chromiumPath,
      args: ["--no-sandbox", `--proxy-server=${proxy.url}`, PROXY_BYPASS_FLAG],
    });
    cleanups.push(() => browser.close());
    const session = pageSession(
      await browser.newPage(),
      { viewportWidth: 1280, viewportHeight: 800 },
      { close: async () => {}, guard: await navigationGuard(browser, { resolveHost: null }) },
    );

    await expect(session.navigate(`https://router.lan:${target.port}/`)).rejects.toThrow(
      "The browser's proxy refused or couldn't reach that site. Private and local addresses can't be fetched.",
    );
    await expect(session.navigate(`http://router.lan:${target.port}/`)).rejects.toThrow(
      "Private and local addresses can't be fetched.",
    );
    expect(session.url()).toBe("about:blank");
    expect(target.hits).toEqual([]);
  }, 30_000);
});
