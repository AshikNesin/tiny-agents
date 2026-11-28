import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import type { BrowserContext, Locator, Page, Response } from "playwright-core";
import { fillSecretFields, pageOrigin, refOrigin } from "./browser-fill";
import { assertRefShape, isBlockedPrivateUrl, parseExemptHosts } from "./browser-guard";
import { compactSnapshot, tidyText } from "./browser-snapshot";
import { alreadyClosed, metInTime, survived, waitTimedOut } from "./failures";
import { PROXY_BYPASS_FLAG, REFUSED_HEADER, startEgressProxy } from "./egress-proxy";
import type { BrowserSession, BrowserVnc, OpenBrowserOptions } from "./browser-sessions";
import { navigationGuard, type NavigationGuard, type ResolveHost } from "./navigation-guard";

export interface ChromiumTransportOptions {
  executablePath?: string;
  args?: string[];
  locale?: string;
  timezone?: string;
  resolveHost?: ResolveHost;
}

const VM_HEADLESS_SHELL = "/headless-shell/headless-shell";
const DEBIAN_CHROMIUM = "/usr/bin/chromium";

const ACTION_TIMEOUT_MS = 15_000;

const SETTLE_MS = 5_000;

const NAVIGATION_START_MS = 500;

const CHALLENGE_MS = 15_000;

function isSelfSolvingChallenge(response: Response): boolean {
  const headers = response.headers();
  return headers["x-amzn-waf-action"] === "challenge" || headers["cf-mitigated"] === "challenge";
}

async function throughChallenges(page: Page, response: Response | null): Promise<Response | null> {
  const deadline = Date.now() + CHALLENGE_MS;
  let current = response;
  while (current && isSelfSolvingChallenge(current)) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) break;
    const main = page.mainFrame();
    const committed = page
      .waitForEvent("framenavigated", { predicate: (f) => f === main, timeout })
      .catch(waitTimedOut);
    const next = await page
      .waitForResponse(
        (r) => r.request().isNavigationRequest() && r.frame() === main && !isRedirect(r.status()),
        { timeout },
      )
      .catch(waitTimedOut);
    if (!next) break;
    await committed;
    await page.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(waitTimedOut);
    current = next;
  }
  return current;
}

const isRedirect = (status: number) => status >= 300 && status < 400;

const isTunnelRefusal = (error: unknown) =>
  error instanceof Error && error.message.includes("net::ERR_TUNNEL_CONNECTION_FAILED");

const userAgents = new Map<string, Promise<string>>();

function personUserAgent(executable: string): Promise<string> {
  let userAgent = userAgents.get(executable);
  if (!userAgent) {
    userAgent = readUserAgent(executable).catch((error: unknown) => {
      userAgents.delete(executable);
      throw error;
    });
    userAgents.set(executable, userAgent);
  }
  return userAgent;
}

async function readUserAgent(executable: string): Promise<string> {
  const cannotRead = (reason: unknown) =>
    new Error(
      `Could not read the version of ${executable}, so the browser would announce itself as HeadlessChrome: ${String(reason)}`,
    );
  const { stdout } = await promisify(execFile)(executable, ["--version"], {
    timeout: 30_000,
  }).catch((error: unknown) => {
    throw cannotRead(error instanceof Error ? error.message : error);
  });
  const major = /(\d+)\.\d+\.\d+\.\d+/.exec(stdout)?.[1];
  if (!major) throw cannotRead(`no version in "${stdout.trim()}"`);
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function resolveExecutable(explicit?: string): string | undefined {
  if (explicit) return explicit;
  for (const candidate of [VM_HEADLESS_SHELL, DEBIAN_CHROMIUM]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function createChromiumTransport(options: ChromiumTransportOptions = {}) {
  return async (profileDir: string, open: OpenBrowserOptions): Promise<BrowserSession> => {
    const executablePath = resolveExecutable(options.executablePath);
    const userAgent = await personUserAgent(executablePath ?? chromium.executablePath());
    const resolveHost = options.resolveHost ? { resolveHost: options.resolveHost } : {};
    const proxy = await startEgressProxy({
      exempt: parseExemptHosts(open.allowedPrivateHosts),
      ...resolveHost,
    });
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        ...(executablePath ? { executablePath } : { channel: "chromium" as const }),
        viewport: { width: open.viewportWidth, height: open.viewportHeight },
        ignoreDefaultArgs: ["--enable-automation"],
        args: [
          "--disable-blink-features=AutomationControlled",
          `--proxy-server=${proxy.url}`,
          PROXY_BYPASS_FLAG,
          ...(options.args ?? []),
        ],
        userAgent,
        ...(options.locale ? { locale: options.locale } : {}),
        ...(options.timezone ? { timezoneId: options.timezone } : {}),
      });
    } catch (error) {
      await proxy.close();
      throw error;
    }
    context.once("close", () => void proxy.close());
    const page: Page = context.pages()[0] ?? (await context.newPage());
    const browser = context.browser();
    if (!browser) throw new Error("Chromium started without a browser to guard.");
    return pageSession(page, open, {
      guard: await navigationGuard(browser, resolveHost),
      onDisconnect: (listener) => context.once("close", listener),
      close: async () => {
        await context.close().catch(alreadyClosed("closing the browser context"));
        await proxy.close();
      },
    });
  };
}

export function pageSession(
  initialPage: Page,
  open: OpenBrowserOptions,
  teardown: {
    close: (current: Page) => Promise<void>;
    onDisconnect?: (listener: () => void) => void;
    vnc?: BrowserVnc;
    guard?: NavigationGuard;
  },
  claimed: Set<Page> = new Set(),
): BrowserSession {
  const exempt = parseExemptHosts(open.allowedPrivateHosts);
  const guard = teardown.guard;
  let page = initialPage;
  let closing = false;
  const mine: Page[] = [];
  const watch = (target: Page) => guard?.watch(target, exempt);
  const hold = (target: Page) => {
    if (mine.includes(target)) return;
    mine.push(target);
    claimed.add(target);
    follow(target);
    void watch(target)?.catch(survived("guarding a held tab (its next action retries)"));
  };
  const letGo = (target: Page) => {
    const at = mine.indexOf(target);
    if (at >= 0) mine.splice(at, 1);
    claimed.delete(target);
    guard?.unwatch(target);
  };

  const switchTo = async (next: Page) => {
    if (next === page) return;
    hold(next);
    page = next;
  };
  const guarded = async <T>(action: (current: Page) => Promise<T>): Promise<T> => {
    const current = page;
    await watch(current);
    return action(current);
  };
  const tabAt = (index: number) => {
    const target = mine[index];
    if (!target || target.isClosed?.()) {
      throw new Error(`There is no tab ${index + 1}; you have ${mine.length}.`);
    }
    return target;
  };

  function follow(target: Page) {
    target.once("close", () => {
      letGo(target);
      if (closing || page !== target) return;
      const remaining = target
        .context()
        .pages()
        .filter((p) => !claimed.has(p));
      const next = mine[mine.length - 1] ?? remaining[remaining.length - 1];
      void (next ? switchTo(next) : target.context().newPage().then(switchTo)).catch(
        alreadyClosed("replacing the closed tab"),
      );
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
      const visible = await visiblePage(page.context().pages());
      if (visible && (visible === page || !claimed.has(visible))) await switchTo(visible);
    },
    openTab: async () => {
      const tab = await page.context().newPage();
      return pageSession(
        tab,
        open,
        {
          close: async (current) => {
            await current.close().catch(alreadyClosed("closing a tab"));
          },
          ...(guard ? { guard } : {}),
        },
        claimed,
      );
    },
    focus: () => page.bringToFront(),
    url: () => page.url(),
    navigate: async (url) => {
      if (!guard) throw new Error("This browser has no navigation guard.");
      const current = page;
      const frameId = await guard.watch(current, exempt);
      const mark = guard.mark();
      let response: Response | null = null;
      try {
        response = await current.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        response = await throughChallenges(current, response);
      } catch (error) {
        if (!guard.refusedSince(frameId, mark)) {
          if (!isTunnelRefusal(error)) throw error;
          await leaveForBlank(current);
          throw new Error(
            "The browser's proxy refused or couldn't reach that site. Private and local addresses can't be fetched.",
            { cause: error },
          );
        }
      }
      const hops: string[] = [];
      for (let r = response?.request() ?? null; r; r = r.redirectedFrom()) hops.push(r.url());
      const bad =
        guard.refusedSince(frameId, mark) ??
        hops.find((hop) => isBlockedPrivateUrl(hop, exempt)) ??
        (response?.headers()[REFUSED_HEADER] ? response.url() : undefined);
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
        const before = current.url();
        const response = await current.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!response && current.url() === before) return null;
        await settle(current);
        return { url: current.url(), title: await titleOf(current) };
      }),
    snapshot: (scope) => snapshotOf(page, scope),
    text: (scope) => textOf(page, scope),
    waitFor: (wait) => waitForText(page, wait),
    origin: () => pageOrigin(page),
    refOrigin: (ref) => refOrigin(page, ref),
    fillSecret: (fill) => guarded((current) => fillSecretFields(current, fill)),
    click: (ref) =>
      guarded(async (current) => {
        const popup = current
          .waitForEvent("popup", { timeout: NAVIGATION_START_MS })
          .catch(waitTimedOut);
        await settleAfter(current, () => clickRef(current, ref));
        const opened = await popup;
        if (!opened) return { url: current.url() };
        await opened
          .waitForLoadState("domcontentloaded", { timeout: SETTLE_MS })
          .catch(waitTimedOut);
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
      await page.bringToFront().catch(survived("bringing the tab to the front"));
      await watch(page);
      return { url: page.url(), title: await titleOf(page) };
    },
    closeTabAt: async (index) => {
      const target = tabAt(index);
      if (mine.length === 1) throw new Error("This is your only tab; it can't be closed.");
      if (target === page) {
        await switchTo(mine[index === mine.length - 1 ? index - 1 : index + 1]!);
        await page.bringToFront().catch(survived("bringing the tab to the front"));
      }
      letGo(target);
      await target.close();
    },
    type: (ref, text) => guarded((current) => typeRef(current, ref, text)),
    press: (key) =>
      guarded((current) =>
        key === "Enter"
          ? settleAfter(current, () => current.keyboard.press(key))
          : current.keyboard.press(key),
      ),
    scroll: (direction, amount) =>
      guarded((current) => scrollPage(current, open, direction, amount)),
    screenshot: async (options) => {
      const current = page;
      const capture = async () =>
        (await current.screenshot({ type: "jpeg", quality: 60, scale: "css" })).toString("base64");
      if (!options?.labels) return { data: await capture() };
      const labels = await drawRefLabels(current);
      try {
        return { data: await capture(), labeled: labels.count };
      } finally {
        await current
          .evaluate((id) => document.getElementById(id)?.remove(), labels.id)
          .catch(survived("removing the ref labels from the page"));
      }
    },
    release: () => {
      for (const tab of mine.filter((t) => t !== page)) {
        letGo(tab);
        void tab.close().catch(alreadyClosed("closing a released tab"));
      }
      guard?.unwatch(page);
    },
    close: async () => {
      closing = true;
      const others = mine.filter((tab) => tab !== page);
      for (const tab of [...mine]) letGo(tab);
      await Promise.all(others.map((tab) => tab.close().catch(alreadyClosed("closing a tab"))));
      await teardown.close(page);
    },
  };
  return session;
}

const MAX_LABELS = 150;

async function drawRefLabels(page: Page): Promise<{ id: string; count: number }> {
  const tree = await snapshotOf(page);
  const refs = [...new Set(Array.from(tree.matchAll(/\[ref=(f?\d*e\d+)\]/g), (m) => m[1]!))];
  const viewport = page.viewportSize();
  const inView: { ref: string; x: number; y: number; width: number; height: number }[] = [];
  for (let at = 0; at < refs.length && inView.length < MAX_LABELS; at += MAX_LABELS) {
    const boxes = await Promise.all(
      refs.slice(at, at + MAX_LABELS).map(async (ref) => {
        const box = await page.getByRef(ref).boundingBox({ timeout: 1_000 }).catch(waitTimedOut);
        return box && { ref, x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
    for (const box of boxes) {
      const shown =
        !!box &&
        box.width > 0 &&
        box.height > 0 &&
        box.x + box.width > 0 &&
        box.y + box.height > 0 &&
        (!viewport || (box.x < viewport.width && box.y < viewport.height));
      if (shown && inView.length < MAX_LABELS) inView.push(box);
    }
  }
  const id = `__tiny_agents_ref_labels_${crypto.randomUUID()}`;
  await page.evaluate(
    ({ id, labels }) => {
      const layer = document.createElement("div");
      layer.id = id;
      layer.setAttribute("aria-hidden", "true");
      layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      for (const { ref, x, y, width, height } of labels) {
        const box = document.createElement("div");
        box.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;outline:2px solid #e11d48`;
        const tag = document.createElement("span");
        tag.textContent = ref;
        tag.style.cssText =
          "position:absolute;left:0;top:0;transform:translateY(-100%);background:#e11d48;color:#fff;font:bold 11px/1.2 monospace;padding:0 2px";
        box.append(tag);
        layer.append(box);
      }
      document.documentElement.append(layer);
    },
    { id, labels: inView },
  );
  return { id, count: inView.length };
}

async function leaveForBlank(page: Page): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto("about:blank");
      return;
    } catch (error) {
      last = error;
      await page.waitForLoadState("load", { timeout: 5_000 }).catch(waitTimedOut);
    }
  }
  survived("leaving the refused page for about:blank")(last);
}

function visiblePage(pages: Page[]): Promise<Page | undefined> {
  return new Promise((resolve) => {
    let pending = pages.length;
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
        (error: unknown) => {
          alreadyClosed("reading a tab's visibility")(error);
          settle();
        },
      );
    }
  });
}

async function snapshotOf(page: Page, scope?: string): Promise<string> {
  const root = scope ? (assertRefShape(scope), page.getByRef(scope)) : page.locator("body");
  return compactSnapshot(await root.ariaSnapshot({ mode: "ai", timeout: ACTION_TIMEOUT_MS }));
}

async function textOf(page: Page, scope?: string): Promise<string> {
  const root = scope ? (assertRefShape(scope), page.getByRef(scope)) : page.locator("body");
  return tidyText(await root.innerText({ timeout: ACTION_TIMEOUT_MS }));
}

async function settleAfter<T>(page: Page, action: () => Promise<T>): Promise<T> {
  const main = page.mainFrame();
  const window = { timeout: NAVIGATION_START_MS };
  const navigation = Promise.any([
    page.waitForRequest((r) => r.isNavigationRequest() && r.frame() === main, window),
    page.waitForEvent("framenavigated", { predicate: (f) => f === main, ...window }),
  ])
    .then(() => true)
    .catch(waitTimedOut);
  const result = await action();
  if (await navigation) {
    await page.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(waitTimedOut);
    await settle(page);
  }
  return result;
}

async function waitForText(
  page: Page,
  wait: { text?: string; gone?: boolean; timeoutMs: number },
): Promise<boolean> {
  if (!wait.text) {
    await new Promise((resolve) => setTimeout(resolve, wait.timeoutMs));
    return true;
  }
  const state = wait.gone ? "hidden" : "visible";
  return metInTime(page.getByText(wait.text).first().waitFor({ state, timeout: wait.timeoutMs }));
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load", { timeout: SETTLE_MS }).catch(waitTimedOut);
}

const TITLE_MS = 1_000;

async function titleOf(page: Page): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), TITLE_MS);
  });
  const title = await Promise.race([
    page.title().catch(alreadyClosed("reading the tab's title")),
    late,
  ]);
  clearTimeout(timer);
  return title?.trim() || undefined;
}

async function clickRef(page: Page, ref: string) {
  assertRefShape(ref);
  await page.getByRef(ref).click({ timeout: ACTION_TIMEOUT_MS });
  return { url: page.url() };
}

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
    await locator.selectOption(text, { timeout: ACTION_TIMEOUT_MS });
    return { url: page.url() };
  }
  if (kind === "text") await locator.click({ timeout: ACTION_TIMEOUT_MS });
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
  await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
  await page.mouse.wheel(0, direction === "down" ? amount : -amount);
}
