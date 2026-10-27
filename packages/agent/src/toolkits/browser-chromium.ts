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

/**
 * Bound for the retrying click and fill. Playwright's own default is
 * "wait forever", so a covered element would hang until the tool call
 * itself was killed. Long enough for a slow VM round trip and a few retries.
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
 * the redirect guard and ref snapshot/click/type.
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
    wipeProfile?: () => Promise<void>;
  },
  claimed: Set<Page> = new Set(),
): BrowserSession {
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
    wipeProfile: teardown.wipeProfile,
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
          .replace(/\\s+/g, " ")
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

function assertRef(ref: string) {
  if (!/^e\d+$/.test(ref))
    throw new Error(`Invalid ref "${ref}". Use a ref from the last snapshot.`);
}

const missingRef = (ref: string) =>
  `Ref "${ref}" not found on the page. Take a new browser_snapshot.`;

/**
 * One round trip that scrolls the ref into view and says how to act on it.
 * `text === null` is a click. A string is a type: date-like fields and
 * selects are written here, and text fields come back as a point to click.
 * Source text, so the compiler does not inline helpers into the page.
 */
function prepareScript(ref: string, text: string | null): string {
  return `
(() => {
  const ref = ${JSON.stringify(ref)};
  const text = ${JSON.stringify(text)};
  const el = document.querySelector('[data-ta-ref="' + ref + '"]');
  if (!el) return { action: "missing" };

  const tag = el.tagName;
  const valueTypes = ["color", "date", "time", "datetime-local", "month", "range", "week"];
  const textTypes = ["", "email", "number", "password", "search", "tel", "text", "url"];
  let kind = "other";
  if (tag === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    if (el.disabled || el.readOnly) kind = "locked";
    else if (valueTypes.indexOf(type) !== -1) kind = "value";
    else if (textTypes.indexOf(type) !== -1) kind = "text";
    else kind = "locked";
  } else if (tag === "TEXTAREA") {
    kind = el.disabled || el.readOnly ? "locked" : "text";
  } else if (tag === "SELECT") {
    kind = el.disabled ? "locked" : "select";
  } else if (el.isContentEditable) {
    kind = "text";
  }

  if (text !== null) {
    if (kind === "locked" || kind === "other") return { action: "reject" };
    if (kind === "value") {
      const type = (el.type || "").toLowerCase();
      const next = type === "color" ? text.trim().toLowerCase() : text.trim();
      el.focus();
      el.value = next;
      if (el.value !== next) return { action: "reject", reason: "malformed" };
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { action: "set" };
    }
    if (kind === "select") {
      const options = el.options ? Array.prototype.slice.call(el.options) : [];
      let match = null;
      for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const label = (option.label || option.textContent || "").replace(/\\s+/g, " ").trim();
        if (option.value === text || label === text) { match = option; break; }
      }
      if (!match) return { action: "reject", reason: "option" };
      for (let i = 0; i < options.length; i++) options[i].selected = options[i] === match;
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { action: "set" };
    }
    if (tag === "INPUT" && (el.type || "").toLowerCase() === "number" && isNaN(Number(text.trim()))) {
      return { action: "reject", reason: "number" };
    }
  }

  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1 || window.innerWidth < 2 || window.innerHeight < 2) {
    return { action: "fallback" };
  }
  const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
  const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
  const hit = document.elementFromPoint(x, y);
  if (!hit || (hit !== el && !el.contains(hit) && !hit.contains(el))) return { action: "fallback" };
  return { action: "click", x: x, y: y };
})()`;
}

/** Select the field's current text so one insert replaces it. */
function selectScript(ref: string): string {
  return `
(() => {
  const el = document.querySelector('[data-ta-ref="' + ${JSON.stringify(ref)} + '"]');
  if (!el) return "missing";
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    el.focus();
    try { el.setSelectionRange(0, String(el.value || "").length); } catch (e) {}
    return "needsinput";
  }
  if (el.isContentEditable) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return "needsinput";
  }
  return "missing";
})()`;
}

type Prepared =
  | { action: "missing" | "fallback" | "set" | "reject"; reason?: string }
  | { action: "click"; x: number; y: number };

async function prepare(page: Page, ref: string, text: string | null): Promise<Prepared> {
  return page.evaluate(prepareScript(ref, text), undefined);
}

function rejectReason(ref: string, reason: string | undefined): Error {
  if (reason === "number") return new Error(`Cannot type text into a number field (${ref}).`);
  if (reason === "malformed") return new Error(`That value does not fit field ${ref}.`);
  if (reason === "option") return new Error(`Field ${ref} has no option with that value or label.`);
  return new Error(
    `Element ${ref} is not an editable field. Click it, or type into a text field from the snapshot.`,
  );
}

async function retryingClick(page: Page, ref: string) {
  // Something covers the center, or the element has no box yet. Playwright
  // retries other scroll positions and waits until this element is the one
  // under the cursor.
  await page.locator(`[data-ta-ref="${ref}"]`).click({ timeout: ACTION_TIMEOUT_MS });
}

async function clickRef(page: Page, ref: string) {
  assertRef(ref);
  const prepared = await prepare(page, ref, null);
  if (prepared.action === "missing") throw new Error(missingRef(ref));
  if (prepared.action === "click") await page.mouse.click(prepared.x, prepared.y);
  else await retryingClick(page, ref);
  return { url: page.url() };
}

async function typeRef(page: Page, ref: string, text: string) {
  assertRef(ref);
  const prepared = await prepare(page, ref, text);
  if (prepared.action === "missing") throw new Error(missingRef(ref));
  if (prepared.action === "reject") throw rejectReason(ref, prepared.reason);
  // Date, color, range and selects are written in that same round trip.
  if (prepared.action === "set") return { url: page.url() };

  // Headful Chrome delivers insertText to whichever surface has browser
  // focus, often the address bar. A real click moves that focus into the
  // page. The whole string then goes in as one insert: a key per character
  // is its own round trip on the VM link.
  if (prepared.action === "click") await page.mouse.click(prepared.x, prepared.y);
  else await retryingClick(page, ref);

  if (prepared.action === "fallback") {
    await page.locator(`[data-ta-ref="${ref}"]`).fill(text, { timeout: ACTION_TIMEOUT_MS });
    return { url: page.url() };
  }
  const selected = await page.evaluate(selectScript(ref), undefined);
  if (selected === "missing") throw new Error(missingRef(ref));
  await page.keyboard.insertText(text);
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
