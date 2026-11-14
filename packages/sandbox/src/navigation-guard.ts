/**
 * The browser's navigation guard (S7): every request of an agent's tab's
 * main frame is checked before it is sent, for the tab's whole life, and so
 * is every popup such a tab opens. A navigation, a redirect hop, a meta
 * refresh, a script setting `location`, a click and `window.open` all reach
 * the network as a main-frame document request, so all of them pass here.
 *
 * One DevTools session per browser, at the browser target: its `Fetch`
 * domain pauses document requests from every tab, and `Target` events name
 * each popup's opener before the popup's first request. Tabs no agent holds
 * (the owner's own, in the streamed Chrome) are let through untouched, as
 * are subframes and subresources.
 *
 * Known limits: a name is resolved here, and the browser resolves it again
 * on its own, so DNS rebinding between the two is not caught (only
 * `http_request` pins its connection). On the VM transport the browser
 * resolves names on the VM, which may answer differently from this server.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Browser, Page } from "playwright-core";
import { isBlockedPrivateUrl } from "./browser-guard";
import { isPrivateAddress } from "./public-url";

/** Every address a hostname resolves to. */
export type ResolveHost = (hostname: string) => Promise<string[]>;

const resolveAll: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

/**
 * Whether an agent's tab must not load this URL: not http(s), credentials,
 * a private or local host that is not exempt (`isBlockedPrivateUrl`), or a
 * name that resolves to any private address. A name that does not resolve
 * here is left to the browser, which fails it too.
 */
export async function refusesNavigation(
  raw: string,
  exempt: ReadonlySet<string>,
  resolveHost: ResolveHost = resolveAll,
): Promise<boolean> {
  if (isBlockedPrivateUrl(raw, exempt)) return true;
  const host = new URL(raw).hostname.toLowerCase();
  const bare = host.replace(/^\[|\]$/g, "");
  if (exempt.has(host) || isIP(bare)) return false;
  const addresses = await resolveHost(bare.replace(/\.+$/, "")).catch(() => []);
  return addresses.some(isPrivateAddress);
}

export interface NavigationGuard {
  /**
   * Guard the tab's main frame from now until it closes, with these
   * exempt hosts (its popups inherit them). Idempotent; resolves to the
   * frame's id.
   */
  watch(page: Page, exempt: ReadonlySet<string>): Promise<string>;
  /** A marker for `refusedSince`: refusals counted so far. */
  mark(): number;
  /** The URL the guard last refused in this frame after `mark`, if any. */
  refusedSince(frameId: string, mark: number): string | undefined;
}

const guards = new WeakMap<Browser, Promise<NavigationGuard>>();

/** The browser's one guard, set up on first use. */
export function navigationGuard(
  browser: Browser,
  options: { resolveHost?: ResolveHost } = {},
): Promise<NavigationGuard> {
  let guard = guards.get(browser);
  if (!guard) {
    guard = createGuard(browser, options.resolveHost ?? resolveAll);
    guards.set(browser, guard);
    guard.catch(() => guards.delete(browser));
  }
  return guard;
}

async function createGuard(browser: Browser, resolveHost: ResolveHost): Promise<NavigationGuard> {
  const cdp = await browser.newBrowserCDPSession();
  // A tab's main frame id is its target id, so a request's `frameId` says
  // whether it is a guarded tab's main frame, and a popup's `openerId`
  // whether its opener is guarded.
  const frames = new Map<string, ReadonlySet<string>>();
  const refused = new Map<string, { url: string; at: number }>();
  let refusals = 0;

  cdp.on("Target.targetCreated", ({ targetInfo }) => {
    const inherited = targetInfo.openerId ? frames.get(targetInfo.openerId) : undefined;
    if (inherited && targetInfo.type === "page") frames.set(targetInfo.targetId, inherited);
  });
  cdp.on("Target.targetDestroyed", ({ targetId }) => {
    frames.delete(targetId);
    refused.delete(targetId);
  });
  cdp.on("Fetch.requestPaused", (event) => {
    const exempt = frames.get(event.frameId);
    const verdict = exempt
      ? refusesNavigation(event.request.url, exempt, resolveHost).catch(() => true)
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

  const watched = new WeakMap<Page, Promise<string>>();
  return {
    watch(page, exempt) {
      let frameId = watched.get(page);
      if (!frameId) {
        frameId = mainFrameId(page).then((id) => {
          if (!frames.has(id)) frames.set(id, exempt);
          return id;
        });
        watched.set(page, frameId);
        frameId.catch(() => watched.delete(page));
      }
      return frameId;
    },
    mark: () => refusals,
    refusedSince: (frameId, mark) => {
      const last = refused.get(frameId);
      return last && last.at > mark ? last.url : undefined;
    },
  };
}

async function mainFrameId(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { frameTree } = await cdp.send("Page.getFrameTree");
    return frameTree.frame.id;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}
