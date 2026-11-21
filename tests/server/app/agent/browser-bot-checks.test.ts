import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createChromiumTransport,
  pageSession,
} from "../../../../packages/sandbox/src/browser-chromium";
import type { BrowserSession } from "../../../../packages/sandbox/src/browser-sessions";
import { navigationGuard } from "../../../../packages/sandbox/src/navigation-guard";

const chromiumPath = [
  chromium.executablePath(),
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find((path) => path && existsSync(path));

const open = { viewportWidth: 1280, viewportHeight: 800, allowedPrivateHosts: "localhost" };
const html = (body: string) => ({ headers: { "content-type": "text/html" }, body });

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function serve(
  handler: (
    path: string,
    headers: IncomingHttpHeaders,
  ) => { status?: number; headers?: Record<string, string>; body?: string },
) {
  const requests: IncomingHttpHeaders[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url !== "/favicon.ico") requests.push(req.headers);
    const reply = handler(req.url ?? "", req.headers);
    res.writeHead(reply.status ?? 200, reply.headers);
    res.end(reply.body ?? "");
  });
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { requests, base: `http://localhost:${(server.address() as AddressInfo).port}` };
}

function readText(session: BrowserSession): Promise<string> {
  if (!session.text) throw new Error("This session cannot read text.");
  return session.text();
}

describe.skipIf(!chromiumPath)("bot checks in real Chromium", () => {
  it("waits through a challenge that solves itself and returns the real page", async () => {
    const site = await serve((_path, headers) =>
      headers.cookie?.includes("aws-waf-token=ok")
        ? html("<title>Shop</title><h1>Today's deals</h1>")
        : {
            status: 202,
            headers: { "content-type": "text/html", "x-amzn-waf-action": "challenge" },
            body: `<script>setTimeout(() => { document.cookie = "aws-waf-token=ok"; location.reload(); }, 1500)</script>`,
          },
    );
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
    cleanups.push(() => browser.close());
    const session = pageSession(await browser.newPage(), open, {
      close: async () => {},
      guard: await navigationGuard(browser),
    });

    expect(await session.navigate(`${site.base}/`)).toEqual({
      url: `${site.base}/`,
      status: 200,
      title: "Shop",
    });
    expect(await readText(session)).toBe("Today's deals");
  }, 30_000);

  it("the local browser reads as a person's Chrome in the owner's language and time zone", async () => {
    const site = await serve(() =>
      html(
        `<body><script>document.body.textContent = [
          "webdriver=" + navigator.webdriver,
          "lang=" + navigator.language,
          "tz=" + Intl.DateTimeFormat().resolvedOptions().timeZone,
        ].join(" ")</script></body>`,
      ),
    );
    const profile = mkdtempSync(join(tmpdir(), "ta-bot-checks-"));
    cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
    const transport = createChromiumTransport({
      executablePath: chromiumPath,
      args: ["--no-sandbox"],
      locale: "en-IN",
      timezone: "Asia/Kolkata",
    });
    const session = await transport(profile, open);
    cleanups.push(() => session.close());

    await session.navigate(`${site.base}/`);
    expect(await readText(session)).toMatch(
      /^webdriver=false lang=en-IN tz=Asia\/(Kolkata|Calcutta)$/,
    );
    const [request] = site.requests;
    expect(request?.["user-agent"]).toMatch(/ Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(request?.["user-agent"]).not.toContain("Headless");
    expect(request?.["sec-ch-ua"] ?? "").not.toContain("Headless");
    expect(request?.["accept-language"]).toMatch(/^en-IN/);
  }, 30_000);
});

describe("the browser's user agent", () => {
  it("refuses to open a browser whose version it cannot read, instead of sending HeadlessChrome", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ta-no-version-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const executablePath = join(dir, "chromium");
    writeFileSync(executablePath, "#!/bin/sh\nexit 1\n");
    chmodSync(executablePath, 0o755);
    const transport = createChromiumTransport({ executablePath });

    await expect(transport(join(dir, "profile"), open)).rejects.toThrow(
      `Could not read the version of ${executablePath}`,
    );
  });
});
