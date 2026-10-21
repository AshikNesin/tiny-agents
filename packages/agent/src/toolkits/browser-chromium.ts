/**
 * The local `BrowserSession` transport: one headless Chromium persistent
 * context per profile directory, driven by Playwright. No remote-debugging
 * port is ever opened (CDP has no authentication; Playwright talks to the
 * browser over a pipe). It has no display, so the owner cannot watch it; the
 * live view needs the VM transport (`browser-remote-cdp.ts`).
 */
import { statSync } from "node:fs";
import { chromium } from "playwright-core";
import type { Page } from "playwright-core";
import { isBlockedPrivateUrl } from "./browser";
import type { BrowserSession, BrowserVnc, OpenBrowserOptions } from "./browser";

export interface ChromiumTransportOptions {
  /** Overrides the browser binary; default: the VM's headless shell if
   * present, else Playwright's bundled Chromium. */
  executablePath?: string;
  /** Extra Chromium args (tests may need --no-sandbox on locked-down CI). */
  args?: string[];
}

/** The exe.dev VM ships a dedicated headless-shell build (Chromium 151). */
const VM_HEADLESS_SHELL = "/headless-shell/headless-shell";
/** Debian's apt chromium (installed via railpack aptPackages on deploys). */
const DEBIAN_CHROMIUM = "/usr/bin/chromium";

function resolveExecutable(explicit?: string): string | undefined {
  if (explicit) return explicit;
  // Prefer pre-provisioned system binaries: no download needed, and
  // `pnpm exec playwright install` never has to run on the host.
  for (const candidate of [VM_HEADLESS_SHELL, DEBIAN_CHROMIUM]) {
    try {
      statSync(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return undefined; // Playwright's bundled Chromium
}

export function createChromiumTransport(options: ChromiumTransportOptions = {}) {
  return async (profileDir: string, open: OpenBrowserOptions): Promise<BrowserSession> => {
    const executablePath = resolveExecutable(options.executablePath);
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      // The new headless renderer. Only for Playwright's own browser — an
      // explicit executable (VM headless shell) brings its own channel and
      // must not be overridden.
      ...(executablePath ? { executablePath } : { channel: "chromium" as const }),
      viewport: { width: open.viewportWidth, height: open.viewportHeight },
      ...(options.args?.length ? { args: options.args } : {}),
    });
    const page: Page = context.pages()[0] ?? (await context.newPage());
    return pageSession(page, open, {
      close: async () => {
        await context.close().catch(() => {});
      },
    });
  };
}

/**
 * The page-level session every chromium transport shares: navigation with
 * the redirect guard and ref snapshot/click/type.
 * `teardown.close` disposes the transport-specific resources around the
 * page (local context vs a remote chromium + tunnel).
 */
export function pageSession(
  initialPage: Page,
  open: OpenBrowserOptions,
  teardown: {
    close: () => Promise<void>;
    vnc?: BrowserVnc;
    wipeProfile?: () => Promise<void>;
  },
): BrowserSession {
  // The tab the agent drives. With a streamed desktop the owner can open
  // and close tabs, so this follows them (see `follow`).
  let page = initialPage;
  let closing = false;

  const switchTo = async (next: Page) => {
    if (next === page) return;
    page = next;
    follow(next);
  };

  // When the current tab closes, move to the most recent remaining tab; a
  // closed-out browser gets a fresh blank one so the agent never holds a
  // dead page.
  const follow = (target: Page) => {
    target.once("close", () => {
      if (closing || page !== target) return;
      const remaining = target.context().pages();
      const next = remaining[remaining.length - 1];
      void (next ? switchTo(next) : target.context().newPage().then(switchTo)).catch(() => {});
    });
  };
  follow(page);

  const session: BrowserSession = {
    vnc: teardown.vnc,
    wipeProfile: teardown.wipeProfile,
    adoptActiveTab: async () => {
      const visible = await visiblePage(page.context().pages());
      if (visible) await switchTo(visible);
    },
    url: () => page.url(),
    navigate: async (url) => {
      // Redirect guard: validate every hop of the redirect chain. Route
      // interception never sees redirect hops here, but the response's
      // request chain does (redirectedFrom). A private hop bails to
      // about:blank before any private byte is rendered.
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const hops: string[] = [];
      for (let r = response?.request() ?? null; r; r = r.redirectedFrom()) hops.push(r.url());
      const bad = hops.find((hop) => isBlockedPrivateUrl(hop, open.allowedPrivateHosts));
      if (bad) {
        await page.goto("about:blank").catch(() => {});
        throw new Error(
          `Blocked: the page redirected to a private address (${new URL(bad).host}).`,
        );
      }
      return { url: page.url(), status: response?.status() ?? null };
    },
    snapshot: () => snapshotOf(page),
    click: (ref) => clickRef(page, ref),
    type: (ref, text) => typeRef(page, ref, text),
    press: (key) => page.keyboard.press(key),
    scroll: (direction, amount) => page.mouse.wheel(0, direction === "down" ? amount : -amount),
    screenshot: async () => ({
      // CSS scale: on a 2x desktop the default would double both dimensions
      // and the model would pay for pixels it cannot use.
      data: (await page.screenshot({ type: "jpeg", quality: 60, scale: "css" })).toString("base64"),
    }),
    close: async () => {
      closing = true;
      await teardown.close();
    },
  };
  return session;
}

/** The tab Chrome is showing: the one whose document reports itself visible. */
function visiblePage(pages: Page[]): Promise<Page | undefined> {
  return new Promise((resolve) => {
    let pending = pages.length;
    // A hidden tab can be slow to answer; settle on the first visible one.
    const timer = setTimeout(() => resolve(undefined), 1500);
    const settle = (found?: Page) => {
      if (found || --pending <= 0) {
        clearTimeout(timer);
        resolve(found);
      }
    };
    if (pending === 0) settle();
    for (const p of pages) {
      p.evaluate("document.visibilityState", undefined).then(
        (state) => settle(state === "visible" ? p : undefined),
        () => settle(),
      );
    }
  });
}

/** Inject `data-ta-ref` attributes, then return the serialized aria snapshot. */
async function snapshotOf(page: Page): Promise<string> {
  // Evaluated as source text: TS helpers must not be inlined into the page.
  const script = `
    (() => {
      let n = 0;
      const describe = (el) => {
        const tag = el.tagName.toLowerCase();
        const name = (el.getAttribute("aria-label") || el.textContent || "")
          .replace(/s+/g, " ")
          .trim()
          .slice(0, 80);
        const parts = [
          tag,
          el.getAttribute("role") ? "role=" + el.getAttribute("role") : "",
          el.getAttribute("type") ? "type=" + el.getAttribute("type") : "",
          name ? JSON.stringify(name) : "",
        ];
        return parts.filter(Boolean).join(" ");
      };
      const walk = (el, depth) => {
        const ref = "e" + (++n);
        el.setAttribute("data-ta-ref", ref);
        let out = "  ".repeat(depth) + "- " + describe(el) + " [ref=" + ref + "]";
        for (const child of el.children) {
          out += "\\n" + walk(child, depth + 1);
        }
        return out;
      };
      return walk(document.body, 0);
    })()
  `;
  return page.evaluate(script, undefined);
}

async function locatorFor(page: Page, ref: string) {
  if (!/^e\d+$/.test(ref))
    throw new Error(`Invalid ref "${ref}". Use a ref from the last snapshot.`);
  const locator = page.locator(`[data-ta-ref="${ref}"]`);
  // A stale ref (page changed since the snapshot) must not click something
  // else: refs are re-stamped per snapshot, so a miss is a miss.
  if ((await locator.count()) === 0)
    throw new Error(`Ref "${ref}" not found on the page. Take a new browser_snapshot.`);
  return locator;
}

async function clickRef(page: Page, ref: string) {
  const box = await (await locatorFor(page, ref)).boundingBox();
  if (!box) throw new Error(`Element ${ref} has no box to click.`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return { url: page.url() };
}

async function typeRef(page: Page, ref: string, text: string) {
  const loc = await locatorFor(page, ref);
  await loc.fill("");
  await loc.type(text, { delay: 10 });
  return { url: page.url() };
}
