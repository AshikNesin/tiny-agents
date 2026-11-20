/**
 * The local `BrowserSession` transport: one headless Chromium persistent
 * context per profile directory, driven by Playwright. No remote-debugging
 * port is ever opened (CDP has no authentication; Playwright talks to the
 * browser over a pipe). It has no display, so the owner cannot watch it; the
 * live view needs the VM transport (`browser-remote-cdp.ts`).
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import type { Locator, Page, Response } from "playwright-core";
import { fillSecretFields, pageOrigin } from "./browser-fill";
import { assertRefShape, isBlockedPrivateUrl, parseExemptHosts } from "./browser-guard";
import { compactSnapshot, tidyText } from "./browser-snapshot";
import type { BrowserSession, BrowserVnc, OpenBrowserOptions } from "./browser-sessions";
import { navigationGuard, type NavigationGuard } from "./navigation-guard";

export interface ChromiumTransportOptions {
  /** Overrides the browser binary; default: the VM's headless shell if
   * present, else Playwright's bundled Chromium. */
  executablePath?: string;
  /** Extra Chromium args (tests may need --no-sandbox on locked-down CI). */
  args?: string[];
  /** The language the browser reports (`navigator.language`, Accept-Language), e.g. `en-IN`. */
  locale?: string;
  /** The IANA time zone of the page's clock, e.g. `Asia/Kolkata`. */
  timezone?: string;
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

/**
 * How long a navigation waits past `domcontentloaded` for the `load` event.
 * A script-built page (most of the web) has nothing to read at
 * `domcontentloaded`; a page whose load never settles (a stuck ad, a
 * stream) is read as it is once this runs out.
 */
const SETTLE_MS = 5_000;

/**
 * How long after a click or Enter a navigation may take to start. A link's
 * navigation begins a moment after the click resolves; returning at once
 * gave the old URL and let the next snapshot read the page being left. A
 * click that navigates nowhere pays this once.
 */
const NAVIGATION_START_MS = 500;

/**
 * How long a bot check that solves itself may take to reload into the real
 * page. Amazon's (AWS WAF) runs a script for a second or few, sets a token
 * cookie and reloads; returning before that handed the agent an empty 202.
 */
const CHALLENGE_MS = 15_000;

/**
 * Whether a document is a CDN's automatic bot check, which reloads into the
 * real page once its script has run: AWS WAF (Amazon) and Cloudflare say so
 * in a header. A CAPTCHA (`x-amzn-waf-action: captcha`) waits for a person,
 * so it is returned as it is.
 */
function isSelfSolvingChallenge(response: Response): boolean {
  const headers = response.headers();
  return headers["x-amzn-waf-action"] === "challenge" || headers["cf-mitigated"] === "challenge";
}

/**
 * The main-frame response the tab ends on once a self-solving bot check has
 * reloaded into the real page, or the last one seen when it has not within
 * `CHALLENGE_MS`. Each reload goes through the navigation guard like any
 * other main-frame request.
 */
async function throughChallenges(page: Page, response: Response | null): Promise<Response | null> {
  const deadline = Date.now() + CHALLENGE_MS;
  let current = response;
  while (current && isSelfSolvingChallenge(current)) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) break;
    const main = page.mainFrame();
    // The response comes before its document replaces the challenge's, so
    // wait for that commit too before waiting on the new document.
    const committed = page
      .waitForEvent("framenavigated", { predicate: (f) => f === main, timeout })
      .catch(() => undefined);
    const next = await page
      .waitForResponse(
        (r) => r.request().isNavigationRequest() && r.frame() === main && !isRedirect(r.status()),
        { timeout },
      )
      .catch(() => null);
    if (!next) break;
    await committed;
    await page.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => undefined);
    current = next;
  }
  return current;
}

const isRedirect = (status: number) => status >= 300 && status < 400;

/**
 * The user agent of a person's Chrome of this binary's version. Headless
 * Chromium says `HeadlessChrome`, which sites read as a bot. Undefined when
 * the binary does not say its version.
 */
async function personUserAgent(executable: string): Promise<string | undefined> {
  const { stdout } = await promisify(execFile)(executable, ["--version"], { timeout: 5_000 }).catch(
    () => ({ stdout: "" }),
  );
  const major = /(\d+)\.\d+\.\d+\.\d+/.exec(stdout)?.[1];
  if (!major) return undefined;
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  // Chrome reports only its major version (user agent reduction).
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

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
    const userAgent = await personUserAgent(executablePath ?? chromium.executablePath());
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      // The new headless renderer. Only for Playwright's own browser — an
      // explicit executable (VM headless shell) brings its own channel and
      // must not be overridden.
      ...(executablePath ? { executablePath } : { channel: "chromium" as const }),
      viewport: { width: open.viewportWidth, height: open.viewportHeight },
      // Bot checks (Amazon's among them) turn away a browser that says it is
      // automated: `navigator.webdriver`, a HeadlessChrome user agent, or a
      // UTC clock and en-US on an IP that is somewhere else.
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled", ...(options.args ?? [])],
      ...(userAgent ? { userAgent } : {}),
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.timezone ? { timezoneId: options.timezone } : {}),
    });
    const page: Page = context.pages()[0] ?? (await context.newPage());
    const browser = context.browser();
    if (!browser) throw new Error("Chromium started without a browser to guard.");
    return pageSession(page, open, {
      guard: await navigationGuard(browser),
      onDisconnect: (listener) => context.once("close", listener),
      close: async () => {
        await context.close().catch(() => {});
      },
    });
  };
}

/**
 * The page-level session every chromium transport shares: navigation
 * behind the browser's navigation guard (every main-frame request of the
 * tab checked before it is sent) and ref snapshot/click/type.
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
    /**
     * The browser's navigation guard (`navigationGuard`): every tab the
     * session drives is watched while the session holds it. Without one
     * (stub pages in tests) `navigate` refuses to run.
     */
    guard?: NavigationGuard;
  },
  claimed: Set<Page> = new Set(),
): BrowserSession {
  const exempt = parseExemptHosts(open.allowedPrivateHosts);
  const guard = teardown.guard;
  // The tab the agent drives. With a streamed desktop the owner can open
  // and close tabs, so this follows them (see `follow`).
  let page = initialPage;
  let closing = false;
  /**
   * The agent's tabs, oldest first: the one it started in, the ones its
   * clicks opened, and the ones it was handed. All are held and guarded
   * while open, so another agent never takes one and none loads a private
   * address in the background.
   */
  const mine: Page[] = [];
  /** Guard the tab before the agent acts on it (once while held). */
  const watch = (target: Page) => guard?.watch(target, exempt);
  /** Hold a tab as the agent's. Never waits on it: `guarded` does, before acting. */
  const hold = (target: Page) => {
    if (mine.includes(target)) return;
    mine.push(target);
    claimed.add(target);
    follow(target);
    void watch(target)?.catch(() => undefined);
  };
  /** Let go of a tab that stays open (`release`) or has closed. */
  const letGo = (target: Page) => {
    const at = mine.indexOf(target);
    if (at >= 0) mine.splice(at, 1);
    claimed.delete(target);
    guard?.unwatch(target);
  };

  // Never waits on the tab: a hand-back must not hang on a busy page. The
  // next action waits for the guard instead (`guarded`). The tab it leaves
  // stays the agent's, one `browser_tabs` can switch back to.
  const switchTo = async (next: Page) => {
    if (next === page) return;
    hold(next);
    page = next;
  };
  /** Run an action on the current tab once it is guarded. */
  const guarded = async <T>(action: (current: Page) => Promise<T>): Promise<T> => {
    const current = page;
    await watch(current);
    return action(current);
  };
  /** The agent's open tab at `index` (0-based, oldest first). */
  const tabAt = (index: number) => {
    const target = mine[index];
    if (!target || target.isClosed?.()) {
      throw new Error(`There is no tab ${index + 1}; you have ${mine.length}.`);
    }
    return target;
  };

  // When the agent's current tab closes, move to its newest other tab, else
  // the most recent tab no other agent holds; with none left the agent gets
  // a fresh blank one, so it never holds a dead page.
  function follow(target: Page) {
    target.once("close", () => {
      letGo(target);
      if (closing || page !== target) return;
      const remaining = target
        .context()
        .pages()
        .filter((p) => !claimed.has(p));
      const next = mine[mine.length - 1] ?? remaining[remaining.length - 1];
      void (next ? switchTo(next) : target.context().newPage().then(switchTo)).catch(() => {});
    });
  }
  hold(page);

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
        { close: (current) => current.close().catch(() => {}), ...(guard ? { guard } : {}) },
        claimed,
      );
    },
    focus: () => page.bringToFront(),
    url: () => page.url(),
    navigate: async (url) => {
      // The guard (S7, `navigation-guard.ts`) fails every main-frame request
      // of this tab to a private target before it is sent: the URL itself
      // (a name that resolves privately), each redirect hop, and whatever
      // the page does next. The response's request chain is checked again
      // after the load, as before. A refused load bails to about:blank.
      if (!guard) throw new Error("This browser has no navigation guard.");
      const current = page;
      const frameId = await guard.watch(current, exempt);
      const mark = guard.mark();
      let response: Response | null = null;
      try {
        response = await current.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        response = await throughChallenges(current, response);
      } catch (error) {
        // The refused hop fails the load; say why rather than the net error.
        if (!guard.refusedSince(frameId, mark)) throw error;
      }
      const hops: string[] = [];
      for (let r = response?.request() ?? null; r; r = r.redirectedFrom()) hops.push(r.url());
      const bad =
        guard.refusedSince(frameId, mark) ?? hops.find((hop) => isBlockedPrivateUrl(hop, exempt));
      if (bad) {
        await leaveForBlank(current);
        if (bad === url || bad === new URL(url).href) {
          throw new Error("Private and local addresses can't be fetched.");
        }
        throw new Error(
          `Blocked: the page redirected to a private address (${new URL(bad).host}).`,
        );
      }
      await settle(current);
      return {
        url: current.url(),
        status: response?.status() ?? null,
        title: await titleOf(current),
      };
    },
    back: () =>
      guarded(async (current) => {
        // The guard watches every main-frame request of a held tab, so a
        // history entry on a private address is refused like a navigation.
        const before = current.url();
        const response = await current.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!response && current.url() === before) return null; // no history to go back to
        await settle(current);
        return { url: current.url(), title: await titleOf(current) };
      }),
    snapshot: (scope) => snapshotOf(page, scope),
    text: (scope) => textOf(page, scope),
    waitFor: (wait) => waitForText(page, wait),
    origin: () => pageOrigin(page),
    fillSecret: (fill) => guarded((current) => fillSecretFields(current, fill)),
    click: (ref) =>
      guarded(async (current) => {
        // A link with target=_blank or a window.open: the agent goes on in
        // the tab it opened, which the guard already watches (its opener's).
        const popup = current
          .waitForEvent("popup", { timeout: NAVIGATION_START_MS })
          .catch(() => null);
        await settleAfter(current, () => clickRef(current, ref));
        const opened = await popup;
        if (!opened) return { url: current.url() }; // where the click led, once it settled
        await opened
          .waitForLoadState("domcontentloaded", { timeout: SETTLE_MS })
          .catch(() => undefined);
        await settle(opened);
        await switchTo(opened);
        return { url: opened.url(), newTab: true };
      }),
    tabs: () =>
      Promise.all(
        mine.map(async (tab) => {
          const title = await titleOf(tab);
          return { url: tab.url(), ...(title ? { title } : {}), current: tab === page };
        }),
      ),
    switchTab: async (index) => {
      await switchTo(tabAt(index));
      // In front, where the live view (and the owner) sees it.
      await page.bringToFront().catch(() => undefined);
      await watch(page);
      return { url: page.url(), title: await titleOf(page) };
    },
    closeTabAt: async (index) => {
      const target = tabAt(index);
      if (mine.length === 1) throw new Error("This is your only tab; it can't be closed.");
      if (target === page) {
        await switchTo(mine[index === mine.length - 1 ? index - 1 : index + 1]!);
        await page.bringToFront().catch(() => undefined);
      }
      letGo(target);
      await target.close();
    },
    type: (ref, text) => guarded((current) => typeRef(current, ref, text)),
    press: (key) =>
      guarded((current) =>
        // Enter submits forms; the other keys move within the page.
        key === "Enter"
          ? settleAfter(current, () => current.keyboard.press(key))
          : current.keyboard.press(key),
      ),
    scroll: (direction, amount) =>
      guarded((current) => scrollPage(current, open, direction, amount)),
    screenshot: async () => ({
      // CSS scale: on a 2x desktop the default would double both dimensions
      // and the model would pay for pixels it cannot use.
      data: (await page.screenshot({ type: "jpeg", quality: 60, scale: "css" })).toString("base64"),
    }),
    release: () => {
      // The first tab stays open, unguarded; the tabs the agent opened go.
      for (const tab of mine.filter((t) => t !== page)) {
        letGo(tab);
        void tab.close().catch(() => {});
      }
      guard?.unwatch(page);
    },
    close: async () => {
      closing = true;
      const others = mine.filter((tab) => tab !== page);
      for (const tab of [...mine]) letGo(tab);
      await Promise.all(others.map((tab) => tab.close().catch(() => {})));
      await teardown.close(page);
    },
  };
  return session;
}

/**
 * Leave a refused load for about:blank. The refusal fails `goto` before
 * Chrome commits its error page, and that commit interrupts a navigation
 * started meanwhile, so try once more after it.
 */
async function leaveForBlank(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto("about:blank");
      return;
    } catch {
      await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => undefined);
    }
  }
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
 * Playwright's AI accessibility snapshot, made compact (`compactSnapshot`).
 * Each control is labeled `[ref=e12]` (or `[ref=f1e12]` inside a frame).
 * `getByRef` resolves those refs against the latest snapshot, which is how
 * Playwright MCP clicks and types. Refs stay the same across snapshots of
 * one page, so a snapshot scoped to a region (`scope`) keeps the refs the
 * whole-page one gave.
 */
async function snapshotOf(page: Page, scope?: string): Promise<string> {
  const root = scope ? (assertRefShape(scope), page.getByRef(scope)) : page.locator("body");
  return compactSnapshot(await root.ariaSnapshot({ mode: "ai", timeout: ACTION_TIMEOUT_MS }));
}

/**
 * The text a reader sees (`innerText`: hidden elements left out, blocks on
 * lines of their own), of the page or of one element. On an article it is a
 * fifth of the snapshot or less, because it carries no roles, refs or URLs.
 */
async function textOf(page: Page, scope?: string): Promise<string> {
  const root = scope ? (assertRefShape(scope), page.getByRef(scope)) : page.locator("body");
  return tidyText(await root.innerText({ timeout: ACTION_TIMEOUT_MS }));
}

/**
 * Run a click or key press, then, if it started a navigation of the tab
 * (a new document, or a script-driven route change), wait for that page to
 * settle so the result's URL and the next read are of the page it led to.
 */
async function settleAfter<T>(page: Page, action: () => Promise<T>): Promise<T> {
  const main = page.mainFrame();
  const window = { timeout: NAVIGATION_START_MS };
  const navigation = Promise.any([
    page.waitForRequest((r) => r.isNavigationRequest() && r.frame() === main, window),
    page.waitForEvent("framenavigated", { predicate: (f) => f === main, ...window }),
  ]).then(
    () => true,
    () => false,
  );
  const result = await action();
  if (await navigation) {
    await page.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => undefined);
    await settle(page);
  }
  return result;
}

/**
 * Wait for text to show (a result, a confirmation) or to go (a spinner,
 * "Loading…"), checked by Playwright against what is rendered, in any frame
 * of the page's main document. Without text, a plain pause.
 */
async function waitForText(
  page: Page,
  wait: { text?: string; gone?: boolean; timeoutMs: number },
): Promise<boolean> {
  if (!wait.text) {
    await new Promise((resolve) => setTimeout(resolve, wait.timeoutMs));
    return true;
  }
  const state = wait.gone ? "hidden" : "visible";
  return page
    .getByText(wait.text)
    .first()
    .waitFor({ state, timeout: wait.timeoutMs })
    .then(
      () => true,
      () => false,
    );
}

/** Wait for `load`, up to `SETTLE_MS`; a page that never settles is used as it is. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load", { timeout: SETTLE_MS }).catch(() => undefined);
}

/** How long the title may take: the renderer answers it, and a busy page never does. */
const TITLE_MS = 1_000;

/** The page's title, or undefined when it has none or cannot say in time. */
async function titleOf(page: Page): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), TITLE_MS);
  });
  const title = await Promise.race([page.title().catch(() => ""), late]);
  clearTimeout(timer);
  return title.trim() || undefined;
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
