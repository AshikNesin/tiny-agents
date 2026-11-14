/**
 * The browser's navigation guard (S7): every request of the main frame of a
 * tab an agent holds is checked before it is sent, for as long as an agent
 * holds it, and so is every popup such a tab opens. A navigation, a
 * redirect hop, a meta refresh, a script setting `location`, a click and
 * `window.open` all reach the network as a main-frame document request, so
 * all of them pass here.
 *
 * One DevTools session per browser, at the browser target: its `Fetch`
 * domain pauses document requests from every tab, and `Target` events name
 * each popup's opener before the popup's first request. Tabs no agent holds
 * (the owner's own, in the streamed Chrome, and a tab an agent let go of)
 * are let through at once, as are subframes and subresources. Each pause is
 * one DevTools round trip, so on the VM transport every main-frame document
 * load, the owner's included, waits for one trip over the SSH tunnel.
 *
 * Names are resolved only when the browser shares this server's resolver
 * (`resolveHost`, the local transport). Known limits: the browser resolves
 * the name again on its own, so DNS rebinding between the two lookups is
 * not caught (only `http_request` pins its connection); a lookup that fails
 * or takes longer than `LOOKUP_TIMEOUT_MS` leaves the name to the browser.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Browser, Page } from "playwright-core";
import { isBlockedPrivateUrl } from "./browser-guard";
import { isPrivateAddress } from "./public-url";

/** Every address a hostname resolves to. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

/** How long a name's lookup may hold a paused request. */
const LOOKUP_TIMEOUT_MS = 3_000;
/** How long guarding a tab may take before the agent's action fails. */
const WATCH_TIMEOUT_MS = 5_000;

const resolveAll: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

/** `promise`, or a rejection after `ms`. */
function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Whether an agent's tab must not load this URL: not http(s), credentials,
 * a private or local host that is not exempt (`isBlockedPrivateUrl`), or,
 * with `resolveHost`, a name that resolves to a private address that is not
 * itself exempt. A name that does not resolve here (no answer, or none
 * within `LOOKUP_TIMEOUT_MS`) is left to the browser.
 */
export async function refusesNavigation(
  raw: string,
  exempt: ReadonlySet<string>,
  resolveHost: ResolveHost | null = resolveAll,
): Promise<boolean> {
  if (isBlockedPrivateUrl(raw, exempt)) return true;
  const host = new URL(raw).hostname.toLowerCase();
  const bare = host.replace(/^\[|\]$/g, "");
  const name = bare.replace(/\.+$/, ""); // `nas.lan.` is `nas.lan`
  if (!resolveHost || isIP(bare) || exempt.has(host) || exempt.has(name)) return false;
  const addresses = await within(resolveHost(name), LOOKUP_TIMEOUT_MS, "lookup timed out").catch(
    () => [],
  );
  const exemptAddress = (address: string) => exempt.has(address) || exempt.has(`[${address}]`);
  return addresses.some((address) => isPrivateAddress(address) && !exemptAddress(address));
}

export interface NavigationGuard {
  /**
   * Guard the tab's main frame (and the popups it opens) with these exempt
   * hosts until `unwatch` or until it closes. Idempotent; resolves to the
   * frame's id, and rejects when the browser does not answer in time.
   */
  watch(page: Page, exempt: ReadonlySet<string>): Promise<string>;
  /** No agent holds the tab any more: let it, and its popups, through again. */
  unwatch(page: Page): void;
  /** A marker for `refusedSince`: refusals counted so far. */
  mark(): number;
  /** The URL the guard last refused in this frame after `mark`, if any. */
  refusedSince(frameId: string, mark: number): string | undefined;
}

export interface NavigationGuardOptions {
  /**
   * Resolve names and refuse private answers. Pass it only when the browser
   * uses this server's resolver (the local transport); `null` checks
   * literals and local names only (the VM transport, whose browser resolves
   * on the VM). Default: the system resolver.
   */
  resolveHost?: ResolveHost | null;
}

const guards = new WeakMap<Browser, Promise<NavigationGuard>>();

/** The browser's one guard, set up on first use. */
export function navigationGuard(
  browser: Browser,
  options: NavigationGuardOptions = {},
): Promise<NavigationGuard> {
  let guard = guards.get(browser);
  if (!guard) {
    guard = createGuard(
      browser,
      options.resolveHost === undefined ? resolveAll : options.resolveHost,
    );
    guards.set(browser, guard);
    guard.catch(() => guards.delete(browser));
  }
  return guard;
}

async function createGuard(
  browser: Browser,
  resolveHost: ResolveHost | null,
): Promise<NavigationGuard> {
  const cdp = await browser.newBrowserCDPSession();
  // A tab's main frame id is its target id, so a request's `frameId` says
  // whether it is a guarded main frame, and a popup's `openerId` whether its
  // opener is guarded. `root` is the watched tab a popup descends from.
  const frames = new Map<string, { exempt: ReadonlySet<string>; root: string }>();
  const refused = new Map<string, { url: string; at: number }>();
  let refusals = 0;

  cdp.on("Target.targetCreated", ({ targetInfo }) => {
    const opener = targetInfo.openerId ? frames.get(targetInfo.openerId) : undefined;
    if (opener && targetInfo.type === "page") frames.set(targetInfo.targetId, opener);
  });
  cdp.on("Target.targetDestroyed", ({ targetId }) => {
    frames.delete(targetId);
    refused.delete(targetId);
  });
  cdp.on("Fetch.requestPaused", (event) => {
    const guarded = frames.get(event.frameId);
    const verdict = guarded
      ? refusesNavigation(event.request.url, guarded.exempt, resolveHost).catch(() => true)
      : Promise.resolve(false);
    void verdict.then(async (refuse) => {
      if (refuse) refused.set(event.frameId, { url: event.request.url, at: ++refusals });
      // A request the tab already dropped (a newer navigation) has nothing to answer.
      await (
        refuse
          ? cdp.send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            })
          : cdp.send("Fetch.continueRequest", { requestId: event.requestId })
      ).catch(() => undefined);
    });
  });
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Request" }],
  });

  /** Stop guarding a watched tab and every popup it led to. */
  const drop = (root: string) => {
    for (const [id, frame] of frames) if (frame.root === root) frames.delete(id);
  };
  const watched = new WeakMap<Page, Promise<string>>();
  return {
    watch(page, exempt) {
      const known = watched.get(page);
      if (known) return known;
      const frameId = within(
        mainFrameId(page),
        WATCH_TIMEOUT_MS,
        "The browser tab is not responding, so it can't be guarded. Try again, or open a new tab.",
      ).then((id) => {
        // Let go of (`unwatch`) while this was on its way: stay unguarded.
        if (watched.get(page) === frameId) frames.set(id, { exempt, root: id });
        return id;
      });
      watched.set(page, frameId);
      frameId.catch(() => {
        if (watched.get(page) === frameId) watched.delete(page);
      });
      return frameId;
    },
    unwatch(page) {
      const frameId = watched.get(page);
      watched.delete(page);
      void frameId?.then(drop, () => undefined);
    },
    mark: () => refusals,
    refusedSince: (frameId, mark) => {
      const last = refused.get(frameId);
      return last && last.at > mark ? last.url : undefined;
    },
  };
}

/**
 * The tab's main frame id: its target id, which the browser process answers
 * (`Page.getFrameTree` would wait on a busy renderer, and so does detaching,
 * which is why it is not awaited).
 */
async function mainFrameId(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    return targetInfo.targetId;
  } finally {
    void cdp.detach().catch(() => undefined);
  }
}
