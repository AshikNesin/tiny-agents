import type { SecretFill } from "./browser-fill";
import { parseExemptHosts } from "./browser-guard";
import { survived } from "./failures";
import {
  createLiveSessions,
  realClock,
  type LiveClock,
  type LiveEntry,
  type LiveOpenState,
  type LivePhase,
} from "./live-sessions";

type BrowserPhase = LivePhase;

export interface OpenBrowserOptions {
  viewportWidth: number;
  viewportHeight: number;
  allowedPrivateHosts?: string;
  scale?: number;
  onPhase?: (phase: BrowserPhase) => void;
}

export interface BrowserVnc {
  scale: number;
  openStream(): Promise<import("node:stream").Duplex>;
  resize(width: number, height: number): Promise<void>;
}

export interface BrowserTarget {
  profile: string;
  tab: string;
}

export function conversationBrowserTarget(conversationId: number): BrowserTarget {
  return { profile: String(conversationId), tab: String(conversationId) };
}

export interface BrowserSession {
  vnc?: BrowserVnc;
  adoptActiveTab?(): Promise<void>;
  openTab?(): Promise<BrowserSession>;
  release?(): void;
  focus?(): Promise<void>;
  onDisconnect?(listener: () => void): void;
  url(): string;
  navigate(url: string): Promise<{ url: string; status: number | null; title?: string }>;
  back?(): Promise<{ url: string; title?: string } | null>;
  snapshot(scope?: string): Promise<string>;
  text?(scope?: string): Promise<string>;
  waitFor?(wait: { text?: string; gone?: boolean; timeoutMs: number }): Promise<boolean>;
  origin?(): Promise<string>;
  refOrigin?(ref: string): Promise<string>;
  fillSecret?(fill: SecretFill): Promise<{ filled: string[] }>;
  click(ref: string): Promise<{ url: string; newTab?: boolean }>;
  tabs?(): Promise<{ url: string; title?: string; current: boolean }[]>;
  switchTab?(index: number): Promise<{ url: string; title?: string }>;
  closeTabAt?(index: number): Promise<void>;
  type(ref: string, text: string): Promise<{ url: string }>;
  press(key: string): Promise<void>;
  scroll(direction: "up" | "down", amount: number): Promise<void>;
  screenshot(options?: { labels?: boolean }): Promise<{ data: string; labeled?: number }>;
  close(): Promise<void>;
}

export interface BrowserTransport {
  (profileDir: string, open: OpenBrowserOptions): Promise<BrowserSession>;
  wipe?(profileDir: string): Promise<void>;
}

export type BrowserDriver = "agent" | "human";

export const DEFAULT_BROWSER_PROFILES_DIR = "./data/browser-profiles";

interface LiveBrowserSession extends LiveEntry {
  session: BrowserSession;
  tabs: Map<string, BrowserSession>;
  driver: BrowserDriver;
  front?: string;
}

export interface LiveBrowserTab {
  browser: LiveBrowserSession;
  session: BrowserSession;
}

export type BrowserClock = LiveClock;

export interface BrowserSessionsOptions {
  profilesDir?: string;
  idleMinutes?: number;
  allowedPrivateHosts?: string;
  transport?: BrowserTransport;
  viewportWidth?: number;
  viewportHeight?: number;
  humanDriverWaitMs?: number;
  scale?: number;
  clock?: BrowserClock;
}

type BrowserOpenState = LiveOpenState;

export interface BrowserSessions {
  readonly profilesDir: string;
  readonly exemptHosts: ReadonlySet<string>;
  acquire(target: BrowserTarget): Promise<LiveBrowserTab>;
  peek(target: BrowserTarget): LiveBrowserTab | undefined;
  start(target: BrowserTarget): Promise<LiveBrowserTab>;
  openState(target: BrowserTarget): BrowserOpenState;
  get(target: BrowserTarget): LiveBrowserSession | undefined;
  profiles(): string[];
  readTurn(target: BrowserTarget): Promise<LiveBrowserTab>;
  actionTurn(target: BrowserTarget): Promise<LiveBrowserTab>;
  setDriver(target: BrowserTarget, driver: BrowserDriver): Promise<void>;
  ownerInput(profile: string): void;
  close(target: BrowserTarget, options?: { wipeProfile?: boolean }): Promise<void>;
  closeTab(target: BrowserTarget): Promise<void>;
  closeAll(): Promise<void>;
  fillSecret(target: BrowserTarget, fill: SecretFill): Promise<{ filled: string[] }>;
  tabOrigin(target: BrowserTarget): Promise<string | undefined>;
}

const managers = new Set<BrowserSessions>();

export function describeBrowserError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Executable doesn't exist|playwright install|browserType\.launch/.test(message)) {
    return (
      "No browser is installed on the server. Install one and redeploy: " +
      'either add "chromium" to railpack.json aptPackages (self-hosted deploys), ' +
      "or run `pnpm exec playwright install chromium --with-deps` in the build, " +
      "or set BROWSER_EXECUTABLE_PATH to an existing system binary."
    );
  }
  return message;
}

const OWNER_DRIVING =
  "The owner is driving the browser; wait and retry, or continue without the browser.";

export function createBrowserSessions(options: BrowserSessionsOptions = {}): BrowserSessions {
  const clock = options.clock ?? realClock;
  const profilesDir = (options.profilesDir ?? DEFAULT_BROWSER_PROFILES_DIR).replace(/\/$/, "");
  const exemptHosts = parseExemptHosts(options.allowedPrivateHosts);

  const tabsOpening = new WeakMap<LiveBrowserSession, Map<string, Promise<BrowserSession>>>();

  function profileDir(key: string): string {
    if (!/^[\w-]+$/.test(key)) throw new Error(`Invalid browser profile "${key}".`);
    return `${profilesDir}/${key}`;
  }

  async function transport(): Promise<BrowserTransport> {
    return options.transport ?? (await import("./browser-chromium")).createChromiumTransport();
  }

  const live = createLiveSessions<BrowserSession, LiveBrowserSession>({
    clock,
    idleMs: (options.idleMinutes ?? 10) * 60_000,
    humanDriverWaitMs: options.humanDriverWaitMs ?? 10 * 60_000,
    async launch(key, onPhase) {
      const dir = profileDir(key);
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dir, { recursive: true });
      const session = await (
        await transport()
      )(dir, {
        viewportWidth: options.viewportWidth ?? 1280,
        viewportHeight: options.viewportHeight ?? 800,
        allowedPrivateHosts: options.allowedPrivateHosts,
        scale: options.scale === 1 ? 1 : 2,
        onPhase,
      });
      return session;
    },
    enter: (session, base) => ({ session, tabs: new Map(), ...base }),
    surfaceOf: (entry) => entry.session,
    async wipe(profile) {
      const dir = profileDir(profile);
      const { rmSync } = await import("node:fs");
      rmSync(dir, { recursive: true, force: true });
      await (await transport()).wipe?.(dir);
    },
    touchOnOpen: false,
    touchOnHandBack: false,
    openWaitsForClose: true,
    sweepReleases: false,
    wipeCancelledOpen: false,
    closeErrors: "throw",
    closedWhileOpening: "The browser was closed while it was opening.",
    describeOpenError: describeBrowserError,
    ownerDriving: () => new Error(OWNER_DRIVING),
    handBackIdle(profile) {
      const entry = live.handBack(profile, false);
      if (!entry) return;
      entry.front = undefined;
      live.release(entry);
    },
  });

  async function tabIn(
    profile: string,
    entry: LiveBrowserSession,
    key: string,
  ): Promise<BrowserSession> {
    const existing = entry.tabs.get(key);
    if (existing) return existing;
    if (entry.tabs.size === 0 || !entry.session.openTab) {
      entry.tabs.set(key, entry.session);
      return entry.session;
    }
    let pending = tabsOpening.get(entry)?.get(key);
    if (!pending) {
      const inFlight = tabsOpening.get(entry) ?? new Map<string, Promise<BrowserSession>>();
      tabsOpening.set(entry, inFlight);
      pending = entry.session
        .openTab()
        .then((tab) => {
          if (live.peek(profile) === entry) entry.tabs.set(key, tab);
          return tab;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  async function tabOf(entry: LiveBrowserSession, target: BrowserTarget): Promise<LiveBrowserTab> {
    const tab = await tabIn(target.profile, entry, target.tab);
    entry.lastActivity = clock.now();
    return { browser: entry, session: tab };
  }

  async function acquire(target: BrowserTarget): Promise<LiveBrowserTab> {
    const entry = await live.open(target.profile);
    const tab = await tabIn(target.profile, entry, target.tab);
    entry.lastActivity = clock.now();
    return { browser: entry, session: tab };
  }

  async function bringToFront({ browser, session }: LiveBrowserTab, key: string): Promise<void> {
    if (browser.driver === "human" || browser.front === key) return;
    browser.front = key;
    if (browser.tabs.size > 1)
      await session.focus?.().catch(survived(`bringing tab ${key} to the front`));
  }

  const manager: BrowserSessions = {
    profilesDir,
    exemptHosts,
    acquire,
    peek(target) {
      const entry = live.peek(target.profile);
      const tab = entry?.tabs.get(target.tab);
      return entry && tab ? { browser: entry, session: tab } : undefined;
    },
    async start(target) {
      live.forgetOpenError(target.profile);
      const tab = await acquire(target);
      await bringToFront(tab, target.tab);
      return tab;
    },
    openState: (target) => live.openState(target.profile),
    get: (target) => live.peek(target.profile),
    profiles: () => live.profiles(),
    readTurn: (target) =>
      live.read(target.profile, {
        allowWhileHuman: true,
        pick: (entry) => tabOf(entry, target),
        finish: (tab) => bringToFront(tab, target.tab),
      }),
    actionTurn: (target) =>
      live.act(target.profile, {
        pick: (entry) => tabOf(entry, target),
        finish: (tab) => bringToFront(tab, target.tab),
      }),
    async setDriver(target, driver) {
      if (driver === "human") {
        live.takeOver(target.profile);
        live.ownerInput(target.profile);
        return;
      }
      const entry = live.handBack(target.profile, false);
      if (!entry) return;
      entry.front = undefined;
      const tab = entry.tabs.get(target.tab);
      if (tab) {
        await tab.adoptActiveTab?.().catch(survived("adopting the tab the owner left open"));
        entry.front = target.tab;
      }
      live.release(entry);
    },
    ownerInput: (profile) => live.ownerInput(profile),
    close: (target, { wipeProfile = false } = {}) =>
      live.close(target.profile, { wipe: wipeProfile }),
    async closeTab(target) {
      const entry = live.peek(target.profile);
      const tab = entry?.tabs.get(target.tab);
      if (!entry || !tab) return;
      entry.tabs.delete(target.tab);
      if (entry.front === target.tab) entry.front = undefined;
      if (entry.tabs.size === 0) {
        await live.dispose(target.profile, entry);
        return;
      }
      if ([...entry.tabs.values()].includes(tab)) return;
      if (tab === entry.session) {
        await tab.navigate("about:blank").catch(survived("blanking the closed tab"));
        tab.release?.();
        return;
      }
      await tab.close().catch(survived(`closing tab ${target.tab}`));
    },
    closeAll: () => live.closeAll(),
    async fillSecret(target, fill) {
      const tab = live.peek(target.profile)?.tabs.get(target.tab);
      if (!tab?.fillSecret) throw new Error("The bot's browser is not open any more.");
      return tab.fillSecret(fill);
    },
    async tabOrigin(target) {
      const tab = live.peek(target.profile)?.tabs.get(target.tab);
      return tab?.origin?.().catch(survived(`reading the origin of tab ${target.tab}`));
    },
  };
  managers.add(manager);
  return manager;
}

export async function closeAllBrowserSessions(): Promise<void> {
  await Promise.allSettled([...managers].map((manager) => manager.closeAll()));
}
