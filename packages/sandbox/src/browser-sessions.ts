/**
 * Browser sessions: the one place that knows which browsers are live. A
 * manager instance is created once per server process and handed to both
 * the browser toolkit (tool calls) and the app's routes (status, "Open
 * browser", takeover, reset, the VNC bridge), so nobody reads module state.
 *
 * The lifecycle rules (lazy shared open, cancel-on-close, the driver flag,
 * the idle sweep, `peek` that never launches) are `LiveSessions`'
 * (`live-sessions.ts`). This instance adds what only a browser has: one tab
 * per agent in a shared profile, bringing the acting agent's tab to the
 * front, and adopting the tab the owner left in front on a hand-back. Its
 * options keep the browser's side of the drift (docs/rewrite/README.md
 * §4.2): reads are allowed while the owner drives, and an open waits for a
 * close in progress.
 */
import type { SecretFill } from "./browser-fill";
import { parseExemptHosts } from "./browser-guard";
import {
  createLiveSessions,
  realClock,
  type LiveClock,
  type LiveEntry,
  type LiveOpenState,
  type LivePhase,
} from "./live-sessions";

/** Where a session is while it opens; `installing` is the one-time VM setup. */
type BrowserPhase = LivePhase;

export interface OpenBrowserOptions {
  viewportWidth: number;
  viewportHeight: number;
  /** Hosts exempt from the private-address block (redirect checks honor it). */
  allowedPrivateHosts?: string;
  /** Device pixel ratio for transports that stream a real desktop (1 or 2). */
  scale?: number;
  /** Progress callback for slow opens (first-run VM install). */
  onPhase?: (phase: BrowserPhase) => void;
}

/**
 * A real desktop the owner can watch and drive over VNC. Present only on
 * transports that run a headful browser on a display (the VM transport).
 */
export interface BrowserVnc {
  /** Device pixel ratio of the remote desktop; the viewer scales its size by it. */
  scale: number;
  /** A fresh byte stream to the display's RFB server (one per viewer). */
  openStream(): Promise<import("node:stream").Duplex>;
  /** Fit the browser window to a viewer, in CSS pixels. */
  resize(width: number, height: number): Promise<void>;
}

/**
 * Where a browser call runs: the profile names the browser (one Chrome per
 * profile directory, since Chrome locks it), the tab names the agent's own
 * tab inside it. Agents with different tabs on one profile share its logins
 * without trampling each other's pages.
 */
export interface BrowserTarget {
  profile: string;
  tab: string;
}

/** The mapping without an app resolver: a browser of its own per conversation. */
export function conversationBrowserTarget(conversationId: number): BrowserTarget {
  return { profile: String(conversationId), tab: String(conversationId) };
}

/** What the toolkit and the live-view routes need from a live browser. */
export interface BrowserSession {
  /** Present when the browser runs on a VNC-served display. */
  vnc?: BrowserVnc;
  /** Follow the tab the owner left in front (after a takeover). */
  adoptActiveTab?(): Promise<void>;
  /**
   * Open another agent's tab in this browser (a shared profile). Its
   * `close()` closes only that tab. Transports that cannot leave it out, and
   * the agents then share the one tab.
   */
  openTab?(): Promise<BrowserSession>;
  /** Bring this tab to the front, where the live view (and the owner) sees it. */
  focus?(): Promise<void>;
  /**
   * Call `listener` once if the browser dies under the app (a dropped link to
   * a remote Chrome, Chrome exiting), never after `close()`. Transports that
   * cannot tell leave it out.
   */
  onDisconnect?(listener: () => void): void;
  url(): string;
  navigate(url: string): Promise<{ url: string; status: number | null }>;
  snapshot(): Promise<string>;
  /** The top-level page's origin as the live document reports it ("null" for about:blank). */
  origin?(): Promise<string>;
  /**
   * Fill vault values (issue #56), asserting the origin inside the page
   * before each write; returns the keys filled, never a value. Throws
   * `OriginMismatchError` when the page is elsewhere.
   */
  fillSecret?(fill: SecretFill): Promise<{ filled: string[] }>;
  click(ref: string): Promise<{ url: string }>;
  type(ref: string, text: string): Promise<{ url: string }>;
  press(key: string): Promise<void>;
  scroll(direction: "up" | "down", amount: number): Promise<void>;
  screenshot(): Promise<{ data: string }>;
  close(): Promise<void>;
}

export interface BrowserTransport {
  (profileDir: string, open: OpenBrowserOptions): Promise<BrowserSession>;
  /**
   * Delete the copy of a profile the transport keeps elsewhere (the sandbox
   * VM's). The manager removes the local `profileDir` itself.
   */
  wipe?(profileDir: string): Promise<void>;
}

export type BrowserDriver = "agent" | "human";

/** Where profiles live when `profilesDir` is not set (on the VM, under the SSH user's home). */
export const DEFAULT_BROWSER_PROFILES_DIR = "./data/browser-profiles";

/** One live browser (a profile): shared by every agent whose target names it. */
interface LiveBrowserSession extends LiveEntry {
  /** The browser itself; closing it closes every tab. Also the first agent's tab. */
  session: BrowserSession;
  /** Each agent's tab, by `BrowserTarget.tab`. */
  tabs: Map<string, BrowserSession>;
  /** The owner drives the whole browser, so takeover pauses every agent in it. */
  driver: BrowserDriver;
  /** The tab last brought to the front, so agents only refocus on a change. */
  front?: string;
}

/** An agent's tab in a live browser: what the tools act on. */
export interface LiveBrowserTab {
  browser: LiveBrowserSession;
  session: BrowserSession;
}

/** Timers and the clock, injectable so the idle sweep and driver wait are testable. */
export type BrowserClock = LiveClock;

export interface BrowserSessionsOptions {
  /** Profiles root; one directory per profile key. Default `./data/browser-profiles`. */
  profilesDir?: string;
  /** Idle close in minutes (default 10). */
  idleMinutes?: number;
  /** Comma-separated hosts exempt from the private-address block. */
  allowedPrivateHosts?: string;
  /** Override for tests. Default: Playwright Chromium. */
  transport?: BrowserTransport;
  viewportWidth?: number;
  viewportHeight?: number;
  /** Bound for how long action tools wait while the human drives (ms). */
  humanDriverWaitMs?: number;
  /** Device pixel ratio for VNC-streamed sessions (1 or 2, default 2). */
  scale?: number;
  clock?: BrowserClock;
}

type BrowserOpenState = LiveOpenState;

export interface BrowserSessions {
  /** Profiles root (the reset endpoint wipes under it). */
  readonly profilesDir: string;
  /** Hosts exempt from the private-address block, parsed once. */
  readonly exemptHosts: ReadonlySet<string>;
  /** The live browser for the target's profile, opening it if needed, and the agent's tab in it. */
  acquire(target: BrowserTarget): Promise<LiveBrowserTab>;
  /** The agent's tab if its browser is live; never launches one. */
  peek(target: BrowserTarget): LiveBrowserTab | undefined;
  /**
   * Open the browser and the agent's tab without a tool call (the owner's
   * "Open browser" button), and bring the tab to the front. The first run on
   * a fresh VM installs the stack and can take minutes.
   */
  start(target: BrowserTarget): Promise<LiveBrowserTab>;
  /** What the status route reports for a browser that is not live (yet). */
  openState(target: BrowserTarget): BrowserOpenState;
  /** The live browser for the target's profile, whether or not the agent has a tab in it yet. */
  get(target: BrowserTarget): LiveBrowserSession | undefined;
  /** Profiles with a live browser. */
  profiles(): string[];
  /** Read tools: the agent's tab, brought to the front unless the owner drives. */
  readTurn(target: BrowserTarget): Promise<LiveBrowserTab>;
  /** Action tools: wait while the owner drives (bounded), then the tab, in front. */
  actionTurn(target: BrowserTarget): Promise<LiveBrowserTab>;
  /** Flip the driver of the target's browser; handing back wakes waiting action tools. */
  setDriver(target: BrowserTarget, driver: BrowserDriver): Promise<void>;
  /**
   * Close and remove the target's browser (every tab in it), including one
   * still opening; later calls open fresh. With `wipeProfile` the persisted
   * profile (cookies, logins) goes too, whether or not a browser was live.
   */
  close(target: BrowserTarget, options?: { wipeProfile?: boolean }): Promise<void>;
  /** Release one agent's tab, leaving the other agents in the browser alone. */
  closeTab(target: BrowserTarget): Promise<void>;
  /** Graceful shutdown: close every session so remote browsers do not outlive the app. */
  closeAll(): Promise<void>;
  /** Fill values into the agent's live tab (the credential request submit route). */
  fillSecret(target: BrowserTarget, fill: SecretFill): Promise<{ filled: string[] }>;
  /** The agent's live tab's top-level origin, if its browser is open. */
  tabOrigin(target: BrowserTarget): Promise<string | undefined>;
}

/** Every manager created, so a process-wide shutdown can close them all. */
const managers = new Set<BrowserSessions>();

/** One readable line per failure: a missing browser gets install instructions. */
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

/** What an action says when its wait for the owner's hand-back ran out. */
const OWNER_DRIVING =
  "The owner is driving the browser; wait and retry, or continue without the browser.";

export function createBrowserSessions(options: BrowserSessionsOptions = {}): BrowserSessions {
  const clock = options.clock ?? realClock;
  const profilesDir = (options.profilesDir ?? DEFAULT_BROWSER_PROFILES_DIR).replace(/\/$/, "");
  const exemptHosts = parseExemptHosts(options.allowedPrivateHosts);

  /** In-flight tab opens per browser, by tab key, so one agent never gets two tabs. */
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
      // The profile is checked inside the open, so an invalid one becomes the last open error.
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
    // A hand-back wakes its waiters only after adopting the owner's tab; the sweep must not wake them first.
    sweepReleases: false,
    wipeCancelledOpen: false,
    closeErrors: "throw",
    closedWhileOpening: "The browser was closed while it was opening.",
    describeOpenError: describeBrowserError,
    // Reads are allowed while the owner drives (U11), so only an action's wait runs out.
    ownerDriving: () => new Error(OWNER_DRIVING),
  });

  /**
   * The agent's tab: the browser's first tab goes to the first agent, later
   * agents get a new tab each (or share the first where the transport
   * cannot open tabs).
   */
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
          // A browser closed meanwhile took the tab with it; don't record it.
          if (live.peek(profile) === entry) entry.tabs.set(key, tab);
          return tab;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  /** The agent's tab in an open browser; getting it is the activity the idle sweep counts. */
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

  /**
   * Show the agent's tab when several agents share the browser: the live
   * view follows whoever acts, and Chrome throttles a tab that is in the
   * background. Never while the owner drives (their tab stays in front).
   */
  async function bringToFront({ browser, session }: LiveBrowserTab, key: string): Promise<void> {
    if (browser.driver === "human" || browser.front === key) return;
    browser.front = key;
    if (browser.tabs.size > 1) await session.focus?.().catch(() => {});
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
        return;
      }
      // Waiters wake only once the agent adopted the owner's tab (`release` below).
      const entry = live.handBack(target.profile, false);
      if (!entry) return;
      // The owner may have opened or switched tabs while driving; the agent
      // they hand back to continues from whichever tab they left in front.
      entry.front = undefined;
      const tab = entry.tabs.get(target.tab);
      if (tab) {
        await tab.adoptActiveTab?.().catch(() => {});
        entry.front = target.tab;
      }
      live.release(entry);
    },
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
      // A transport without openTab shares one tab between agents: keep it.
      if ([...entry.tabs.values()].includes(tab)) return;
      if (tab === entry.session) {
        // The browser's first tab cannot close without closing the browser:
        // blank it and leave it unassigned.
        await tab.navigate("about:blank").catch(() => undefined);
        return;
      }
      await tab.close().catch(() => undefined);
    },
    closeAll: () => live.closeAll(),
    async fillSecret(target, fill) {
      const tab = live.peek(target.profile)?.tabs.get(target.tab);
      if (!tab?.fillSecret) throw new Error("The bot's browser is not open any more.");
      return tab.fillSecret(fill);
    },
    async tabOrigin(target) {
      const tab = live.peek(target.profile)?.tabs.get(target.tab);
      return tab?.origin?.().catch(() => undefined);
    },
  };
  managers.add(manager);
  return manager;
}

/** Graceful shutdown: close every browser of every manager this process created. */
export async function closeAllBrowserSessions(): Promise<void> {
  await Promise.allSettled([...managers].map((manager) => manager.closeAll()));
}
