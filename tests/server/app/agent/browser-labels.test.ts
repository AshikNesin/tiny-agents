/**
 * Screenshots labeled with refs, in real Chromium: each control in view gets
 * its ref drawn on it for that one capture, and the page is left as it was.
 */
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { pageSession } from "../../../../packages/sandbox/src/browser-chromium";

/** A Chromium this machine has, if any (CI may have none). */
const chromiumPath = [
  chromium.executablePath(),
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find((path) => path && existsSync(path));

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe.skipIf(!chromiumPath)("labeled screenshots in real Chromium", () => {
  it("labels the controls in view with their refs, then takes the labels away", async () => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
    cleanups.push(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.setContent(
      `<button>Buy</button><a href="#">Help</a><div style="height:2000px"></div><button>Far below</button>`,
    );
    const session = pageSession(
      page,
      { viewportWidth: 400, viewportHeight: 300 },
      { close: async () => {} },
    );
    const before = await session.snapshot();
    const plain = await session.screenshot();

    const labeled = await session.screenshot({ labels: true });
    // The button and the link are in view; the one 2000px down is not.
    expect(labeled.labeled).toBe(2);
    expect(labeled.data).not.toBe(plain.data);

    expect(await session.snapshot()).toBe(before);
    expect((await session.screenshot()).data).toBe(plain.data);
  }, 30_000);
  it("labels the controls in view on a page scrolled past many others", async () => {
    const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
    cleanups.push(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    const many = Array.from({ length: 200 }, (_, i) => `<button>Item ${i}</button><br>`).join("");
    await page.setContent(`${many}<button>Last</button>`);
    await page.getByText("Last").scrollIntoViewIfNeeded();
    const session = pageSession(
      page,
      { viewportWidth: 400, viewportHeight: 300 },
      { close: async () => {} },
    );
    const labeled = await session.screenshot({ labels: true });
    expect(labeled.labeled).toBeGreaterThan(5);
  }, 30_000);
});
