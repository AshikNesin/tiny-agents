/**
 * The local `BrowserSession` transport: one headless Chromium persistent
 * context per profile directory, driven by Playwright. No remote-debugging
 * port is ever opened (CDP has no authentication; Playwright talks to the
 * browser over a pipe). It has no display, so the owner cannot watch it; the
 * live view needs the VM transport (`browser-remote-cdp.ts`).
 */
import { statSync } from "node:fs";
import { chromium } from "playwright-core";
import type { Locator, Page, Response } from "playwright-core";
import { fillSecretFields, pageOrigin } from "./browser-fill";
import { assertRefShape, isBlockedPrivateUrl, parseExemptHosts } from "./browser-guard";
import type { BrowserSession, BrowserVnc, OpenBrowserOptions } from "./browser-sessions";

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

/**
 * Bound for a snapshot, click, or fill. Playwright's own default is "wait
 * forever", so a missing ref would hang until the tool call itself was
 * killed. Long enough for a slow VM round trip and a few retries.
 */
const ACTION_TIMEOUT_MS = 15_000;

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
      onDisconnect: (listener) => context.once("close", listener),
      close: async () => {
        await context.close().catch(() => {});
      },
    });
  };
}

/**
 * The page-level session every chromium transport shares: navigation with
 * the redirect guard (each hop checked before it is sent) and ref
 * snapshot/click/type.
 * `teardown.close` disposes the transport-specific resources around the
 * page (local context vs a remote chromium + tunnel). `openTab` gives
 * another agent a tab of its own in the same browser; `claimed` is the set
 * of tabs agents hold, shared by every tab session of one browser.
 */
export function pageSession(
  initialPage: Page,
  open: OpenBrowserOptions,
  teardown: {
    /** Gets the tab the session holds at close (it follows the owner's tabs). */
    close: (current: Page) => Promise<void>;
    /** Subscribe to the browser dying; see `BrowserSession.onDisconnect`. */
    onDisconnect?: (listener: () => void) => void;
    vnc?: BrowserVnc;
  },
  claimed: Set<Page> = new Set(),
): BrowserSession {
  const exempt = parseExemptHosts(open.allowedPrivateHosts);
  // The tab the agent drives. With a streamed desktop the owner can open
  // and close tabs, so this follows them (see `follow`).
  let page = initialPage;
  let closing = false;
  claimed.add(page);

  const switchTo = async (next: Page) => {
    if (next === page) return;
    claimed.delete(page);
    claimed.add(next);
    page = next;
    follow(next);
  };

  // When the current tab closes, move to the most recent tab no other agent
  // holds; with none left the agent gets a fresh blank one, so it never
  // holds a dead page.
  const follow = (target: Page) => {
    target.once("close", () => {
      if (closing || page !== target) return;
      claimed.delete(target);
      const remaining = target
        .context()
        .pages()
        .filter((p) => !claimed.has(p));
      const next = remaining[remaining.length - 1];
      void (next ? switchTo(next) : target.context().newPage().then(switchTo)).catch(() => {});
    });
  };
  follow(page);

  const session: BrowserSession = {
    vnc: teardown.vnc,
    onDisconnect: (listener) =>
      teardown.onDisconnect?.(() => {
        if (!closing) listener();
      }),
    adoptActiveTab: async () => {
      // Another agent's tab stays theirs, even if the owner left it in front.
      const visible = await visiblePage(page.context().pages());
      if (visible && (visible === page || !claimed.has(visible))) await switchTo(visible);
    },
    openTab: async () => {
      const tab = await page.context().newPage();
      return pageSession(
        tab,
        open,
        { close: (current) => current.close().catch(() => {}) },
        claimed,
      );
    },
    focus: () => page.bringToFront(),
    url: () => page.url(),
    navigate: async (url) => {
      // Redirect guard (S7): every hop of the main frame's navigation is
      // checked before its request is sent (`guardNavigation`), so a public
      // page that redirects to a private address never reaches it. The
      // response's request chain (redirectedFrom) is checked again after
      // the load, as before. A private hop bails to about:blank.
      const guard = await guardNavigation(page, exempt);
      let response: Response | null = null;
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch (error) {
        // The refused hop fails the load; say why rather than the net error.
        if (!guard.refused()) throw error;
      } finally {
        await guard.stop();
      }
      const hops: string[] = [];
      for (let r = response?.request() ?? null; r; r = r.redirectedFrom()) hops.push(r.url());
      const bad = guard.refused() ?? hops.find((hop) => isBlockedPrivateUrl(hop, exempt));
      if (bad) {
        await page.goto("about:blank").catch(() => {});
        throw new Error(
          `Blocked: the page redirected to a private address (${new URL(bad).host}).`,
        );
      }
      return { url: page.url(), status: response?.status() ?? null };
    },
    snapshot: () => snapshotOf(page),
    origin: () => pageOrigin(page),
    fillSecret: (fill) => fillSecretFields(page, fill),
    click: (ref) => clickRef(page, ref),
    type: (ref, text) => typeRef(page, ref, text),
    press: (key) => page.keyboard.press(key),
    scroll: (direction, amount) => scrollPage(page, open, direction, amount),
    screenshot: async () => ({
      // CSS scale: on a 2x desktop the default would double both dimensions
      // and the model would pay for pixels it cannot use.
      data: (await page.screenshot({ type: "jpeg", quality: 60, scale: "css" })).toString("base64"),
    }),
    close: async () => {
      closing = true;
      claimed.delete(page);
      await teardown.close(page);
    },
  };
  return session;
}

/**
 * Check each request of the page's main frame before it is sent, until
 * `stop()`: the navigation's first URL and every redirect hop after it
 * (Playwright's route interception never sees redirect hops; the DevTools
 * Fetch domain pauses each one). A private, non-exempt hop is failed with
 * `BlockedByClient`, so the request never leaves, and `refused()` names it.
 */
async function guardNavigation(
  page: Page,
  exempt: ReadonlySet<string>,
): Promise<{ refused(): string | undefined; stop(): Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  let refused: string | undefined;
  try {
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const mainFrame = frameTree.frame.id;
    cdp.on("Fetch.requestPaused", (event) => {
      const refuse = event.frameId === mainFrame && isBlockedPrivateUrl(event.request.url, exempt);
      if (refuse) refused ??= event.request.url;
      const answered = refuse
        ? cdp.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          })
        : cdp.send("Fetch.continueRequest", { requestId: event.requestId });
      // A request the page already dropped (a newer navigation) has nothing to answer.
      answered.catch(() => undefined);
    });
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }],
    });
  } catch (error) {
    await cdp.detach().catch(() => undefined);
    throw error;
  }
  return {
    refused: () => refused,
    stop: async () => {
      await cdp.send("Fetch.disable").catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    },
  };
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

/**
 * Playwright's AI accessibility snapshot. Each interactive element is
 * labeled `[ref=e12]` (or `[ref=f1e12]` inside a frame). `getByRef`
 * resolves those refs against this latest snapshot, which is how
 * Playwright MCP clicks and types.
 */
async function snapshotOf(page: Page): Promise<string> {
  return page.locator("body").ariaSnapshot({ mode: "ai", timeout: ACTION_TIMEOUT_MS });
}

async function clickRef(page: Page, ref: string) {
  assertRefShape(ref);
  // Scrolls into view and retries until this element is the one under the cursor.
  await page.getByRef(ref).click({ timeout: ACTION_TIMEOUT_MS });
  return { url: page.url() };
}

/**
 * `fill` sets date, color, range and other value inputs itself, and
 * `selectOption` picks a dropdown's option by label or value (`fill` throws
 * on a <select>). A click on those opens the native picker, so they are
 * never clicked. Text fields go through CDP insertion, which on headful
 * Chrome lands on whichever surface has browser focus — often the address
 * bar — so those are clicked first.
 */
async function fieldKind(locator: Locator, ref: string): Promise<"text" | "set" | "select"> {
  const kind = await locator.evaluate((el) => {
    const tag = el.tagName;
    if (tag === "SELECT") return (el as HTMLSelectElement).disabled ? "locked" : "select";
    if (tag === "TEXTAREA") {
      const area = el as HTMLTextAreaElement;
      return area.disabled || area.readOnly ? "locked" : "text";
    }
    if (tag === "INPUT") {
      const input = el as HTMLInputElement;
      const type = (input.type || "text").toLowerCase();
      if (input.disabled || input.readOnly) return "locked";
      const valueTypes = ["color", "date", "time", "datetime-local", "month", "range", "week"];
      const textTypes = ["", "email", "number", "password", "search", "tel", "text", "url"];
      if (valueTypes.includes(type)) return "set";
      if (textTypes.includes(type)) return "text";
      return "locked";
    }
    if ((el as HTMLElement).isContentEditable) return "text";
    return "other";
  });
  if (kind !== "text" && kind !== "set" && kind !== "select") {
    throw new Error(
      `Element ${ref} is not an editable field. Click it, or type into a text field from the snapshot.`,
    );
  }
  return kind;
}

async function typeRef(page: Page, ref: string, text: string) {
  assertRefShape(ref);
  const locator = page.getByRef(ref);
  const kind = await fieldKind(locator, ref);
  if (kind === "select") {
    // Matches an option's value or its label; throws when none matches.
    await locator.selectOption(text, { timeout: ACTION_TIMEOUT_MS });
    return { url: page.url() };
  }
  if (kind === "text") await locator.click({ timeout: ACTION_TIMEOUT_MS });
  // One fill replaces the value. A key per character is a round trip each
  // on the VM link and timed out on anything longer than a short phrase.
  await locator.fill(text, { timeout: ACTION_TIMEOUT_MS });
  return { url: page.url() };
}

async function scrollPage(
  page: Page,
  open: OpenBrowserOptions,
  direction: "up" | "down",
  amount: number,
) {
  const viewport = page.viewportSize() ?? {
    width: open.viewportWidth,
    height: open.viewportHeight,
  };
  // A wheel event hits whatever is under the cursor. On the VM that cursor
  // is often the address bar or a point left over from the last action, so
  // park it in the page first.
  await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
  await page.mouse.wheel(0, direction === "down" ? amount : -amount);
}
