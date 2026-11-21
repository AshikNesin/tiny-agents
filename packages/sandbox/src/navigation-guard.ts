import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Browser, Page } from "playwright-core";
import { isBlockedPrivateUrl } from "./browser-guard";
import { isPrivateAddress } from "./public-url";

export type ResolveHost = (hostname: string) => Promise<string[]>;

const LOOKUP_TIMEOUT_MS = 3_000;
const WATCH_TIMEOUT_MS = 5_000;

const resolveAll: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function refusesNavigation(
  raw: string,
  exempt: ReadonlySet<string>,
  resolveHost: ResolveHost | null = resolveAll,
): Promise<boolean> {
  if (isBlockedPrivateUrl(raw, exempt)) return true;
  const host = new URL(raw).hostname.toLowerCase();
  const bare = host.replace(/^\[|\]$/g, "");
  const name = bare.replace(/\.+$/, "");
  if (!resolveHost || isIP(bare) || exempt.has(host) || exempt.has(name)) return false;
  const addresses = await within(resolveHost(name), LOOKUP_TIMEOUT_MS, "lookup timed out").catch(
    () => [],
  );
  const exemptAddress = (address: string) => exempt.has(address) || exempt.has(`[${address}]`);
  return addresses.some((address) => isPrivateAddress(address) && !exemptAddress(address));
}

export interface NavigationGuard {
  watch(page: Page, exempt: ReadonlySet<string>): Promise<string>;
  unwatch(page: Page): void;
  mark(): number;
  refusedSince(frameId: string, mark: number): string | undefined;
}

export interface NavigationGuardOptions {
  resolveHost?: ResolveHost | null;
}

const guards = new WeakMap<Browser, Promise<NavigationGuard>>();

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

async function mainFrameId(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    return targetInfo.targetId;
  } finally {
    void cdp.detach().catch(() => undefined);
  }
}
