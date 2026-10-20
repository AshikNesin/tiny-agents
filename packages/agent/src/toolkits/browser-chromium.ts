/**
 * The production `BrowserSession` transport: one Chromium persistent context
 * per profile directory, driven by Playwright, watched through one CDP
 * session. No remote-debugging port is ever opened (CDP has no
 * authentication; Playwright talks to the browser over a pipe).
 *
 * Screencast frames come from CDP `Page.screencastFrame` (JPEG) and are
 * acked immediately so Chrome keeps its own pacing; the consumer's back-
 * pressure is a drop-oldest ring of one, because a stale frame is worthless.
 */
import { statSync } from "node:fs";
import { chromium } from "playwright-core";
import type { CDPSession, Page } from "playwright-core";
import { isBlockedPrivateUrl } from "./browser";
import type {
  BrowserFrame,
  BrowserInput,
  BrowserSession,
  BrowserSessionEvents,
  OpenBrowserOptions,
} from "./browser";

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
      // The new headless renderer; screencast works. Only for Playwright's
      // own browser — an explicit executable (VM headless shell) brings its
      // own channel and must not be overridden.
      ...(executablePath ? { executablePath } : { channel: "chromium" as const }),
      viewport: { width: open.viewportWidth, height: open.viewportHeight },
      ...(options.args?.length ? { args: options.args } : {}),
    });
    const page: Page = context.pages()[0] ?? (await context.newPage());

    let cdp: Awaited<ReturnType<typeof context.newCDPSession>> | undefined;
    const listeners = new Set<BrowserSessionEvents>();
    let screencasting = false;

    const session: BrowserSession = {
      url: () => page.url(),
      on: (events) => {
        listeners.add(events);
        return () => listeners.delete(events);
      },
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
        data: (await page.screenshot({ type: "jpeg", quality: 60 })).toString("base64"),
      }),
      input: (event) => injectInput(page, event),
      startScreencast: async () => {
        cdp ??= await context.newCDPSession(page);
        if (screencasting) return;
        screencasting = true;
        cdp.on("Page.screencastFrame", (frame) => {
          void cdp?.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
          for (const l of listeners) l.frame?.({ jpeg: Buffer.from(frame.data, "base64") });
        });
        await cdp.send("Page.enable");
        await cdp.send("Page.startScreencast", {
          format: "jpeg",
          quality: 60,
          maxWidth: open.viewportWidth,
          maxHeight: open.viewportHeight,
          everyNthFrame: 1,
        });
      },
      stopScreencast: async () => {
        screencasting = false;
        await cdp?.send("Page.stopScreencast").catch(() => {});
      },
      close: async () => {
        for (const l of listeners) l.closed?.();
        listeners.clear();
        await context.close().catch(() => {});
      },
    };
    return session;
  };
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

/** Human and agent input are peers: both land as CDP input events. */
async function injectInput(page: Page, event: BrowserInput) {
  // One CDP session per page, reused: fresh sessions dropped the first
  // keystrokes (the page had not seen the session's Input domain yet).
  const cdp = await cdpFor(page);
  try {
    if (event.kind === "mouse") {
      const base = { x: event.x, y: event.y, button: "left" as const, clickCount: 1 };
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
    } else if (event.kind === "scroll") {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: event.x,
        y: event.y,
        deltaX: 0,
        deltaY: event.deltaY,
      });
    } else if (event.kind === "key") {
      if (event.text) {
        // Printable: text carries the character.
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: event.text });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: event.text });
      } else {
        const code = KEY_CODES[event.key];
        await cdp.send("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          key: event.key,
          code,
          windowsVirtualKeyCode: VK[event.key],
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: event.key,
          code,
          windowsVirtualKeyCode: VK[event.key],
        });
      }
    }
  } catch (error) {
    inputCdpByPage.delete(page); // a broken session must not be cached
    throw error;
  }
}

const inputCdpByPage = new WeakMap<Page, CDPSession>();
async function cdpFor(page: Page) {
  let cdp = inputCdpByPage.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    inputCdpByPage.set(page, cdp);
  }
  return cdp;
}

const KEY_CODES: Record<string, string> = {
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Escape: "Escape",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

const VK: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 8,
  Delete: 46,
  Escape: 27,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
};

export type { BrowserFrame };
