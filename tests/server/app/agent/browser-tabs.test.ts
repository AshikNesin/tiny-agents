/**
 * The tabs an agent's clicks open, in real Chromium: a link that opens a new
 * tab takes the agent there, and the agent can list its tabs, switch back
 * and close one.
 */
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { pageSession } from "../../../../packages/sandbox/src/browser-chromium";
import { navigationGuard } from "../../../../packages/sandbox/src/navigation-guard";

/** A Chromium this machine has, if any (CI may have none). */
const chromiumPath = [
  chromium.executablePath(),
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find((path) => path && existsSync(path));

const open = { viewportWidth: 1280, viewportHeight: 800, allowedPrivateHosts: "localhost" };

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const PAGES: Record<string, string> = {
  "/": `<title>Results</title><a href="/item" target="_blank">Open item</a>`,
  "/item": `<title>Item</title><h1>The item</h1>`,
};

async function serve() {
  const server: Server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(PAGES[req.url ?? ""] ?? "");
  });
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

describe.skipIf(!chromiumPath)("an agent's tabs in real Chromium", () => {
  it("follows a link into the tab it opened, then switches back and closes it", async () => {
    const base = await serve();
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
    cleanups.push(() => browser.close());
    const session = pageSession(await browser.newPage(), open, {
      close: async () => {},
      guard: await navigationGuard(browser),
    });
    await session.navigate(`${base}/`);
    const link = /link "Open item" \[ref=(\w+)\]/.exec(await session.snapshot())?.[1];
    expect(link).toBeDefined();

    expect(await session.click(link!)).toEqual({ url: `${base}/item`, newTab: true });
    expect(await session.text!()).toBe("The item");
    expect(await session.tabs!()).toEqual([
      { url: `${base}/`, title: "Results", current: false },
      { url: `${base}/item`, title: "Item", current: true },
    ]);

    expect(await session.switchTab!(0)).toEqual({ url: `${base}/`, title: "Results" });
    expect(session.url()).toBe(`${base}/`);

    await session.closeTabAt!(1);
    expect(await session.tabs!()).toEqual([{ url: `${base}/`, title: "Results", current: true }]);
    await expect(session.closeTabAt!(0)).rejects.toThrow("only tab");
  }, 30_000);
});
