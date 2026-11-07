/**
 * Browser sessions: the one place that knows which browsers are live. A
 * manager instance is created once per server process and handed to both
 * the browser toolkit (tool calls) and the app's routes (status, "Open
 * browser", takeover, reset, the VNC bridge), so nobody reads module state.
 *
 * It owns the lifecycle rules:
 * - lazy open per profile; concurrent callers share one launch;
 * - close cancels an in-flight open, so a reset or wipe never comes back as
 *   a browser that finished opening after it;
 * - the driver flag: action tools wait on a promise the owner's hand-back
 *   resolves, bounded by `humanDriverWaitMs`;
 * - the idle sweep, on an injectable clock;
 * - `peek`, which never launches: planning a tool call must not start a
 *   browser (or a first-run VM install).
 */
import type { SecretFill } from "./browser-fill";
import { parseExemptHosts } from "./browser-guard";

/** Where a session is while it opens; `installing` is the one-time VM setup. */
type BrowserPhase = "installing" | "starting";

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
  /** Delete the persisted profile; called after `close()` on reset. */
  wipeProfile?(): Promise<void>;
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

export type BrowserTransport = (
  profileDir: string,
  open: OpenBrowserOptions,
) => Promise<BrowserSession>;

export type BrowserDriver = "agent" | "human";

/** One live browser (a profile): shared by every agent whose target names it. */
interface LiveBrowserSession {
  /** The browser itself; closing it closes every tab. Also the first agent's tab. */
  session: BrowserSession;
  /** Each agent's tab, by `BrowserTarget.tab`. */
  tabs: Map<string, BrowserSession>;
  /** The owner drives the whole browser, so takeover pauses every agent in it. */
  driver: BrowserDriver;
  lastActivity: number;
  /** This session's idle close window (ms), from the manager options. */
  idleMs: number;
  /** The tab last brought to the front, so agents only refocus on a change. */
  front?: string;
}

/** An agent's tab in a live browser: what the tools act on. */
export interface LiveBrowserTab {
  browser: LiveBrowserSession;
  session: BrowserSession;
}

/** Timers and the clock, injectable so the idle sweep and driver wait are testable. */
export interface BrowserClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realClock: BrowserClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => {
    const handle = setInterval(fn, ms);
    handle.unref?.();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

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

type BrowserOpenState = { opening: true; phase: BrowserPhase } | { opening: false; error?: string };

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
   * profile (cookies, logins) goes too.
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

const IDLE_SWEEP_MS = 60_000;

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

interface Opening {
  promise: Promise<LiveBrowserSession>;
  readonly phase: BrowserPhase;
  /** A close arrived meanwhile: the opened browser closes at once, and is wiped if asked. */
  cancel(wipe: boolean): void;
}

export function createBrowserSessions(options: BrowserSessionsOptions = {}): BrowserSessions {
  const clock = options.clock ?? realClock;
  const profilesDir = (options.profilesDir ?? "./data/browser-profiles").replace(/\/$/, "");
  const exemptHosts = parseExemptHosts(options.allowedPrivateHosts);
  const idleMs = (options.idleMinutes ?? 10) * 60_000;
  const humanWaitMs = options.humanDriverWaitMs ?? 10 * 60_000;

  const live = new Map<string, LiveBrowserSession>();
  const opening = new Map<string, Opening>();
  /** In-flight tab opens per browser, by tab key, so one agent never gets two tabs. */
  const tabsOpening = new WeakMap<LiveBrowserSession, Map<string, Promise<BrowserSession>>>();
  /** Last open failure per profile, surfaced by the status route until the next attempt. */
  const openErrors = new Map<string, string>();
  /** Action tools waiting for the owner to hand the browser back. */
  const handBacks = new WeakMap<LiveBrowserSession, Set<() => void>>();
  let sweeper: unknown;

  function ensureSweeper() {
    if (sweeper !== undefined) return;
    sweeper = clock.setInterval(() => {
      const now = clock.now();
      for (const [key, entry] of live) {
        if (entry.driver === "human") continue; // an open takeover is activity
        if (entry.lastActivity < now - entry.idleMs) {
          live.delete(key);
          void entry.session.close().catch(() => {});
        }
      }
    }, IDLE_SWEEP_MS);
  }

  async function openSession(
    key: string,
    onPhase: (phase: BrowserPhase) => void,
  ): Promise<LiveBrowserSession> {
    if (!/^[\w-]+$/.test(key)) throw new Error(`Invalid browser profile "${key}".`);
    const dir = `${profilesDir}/${key}`;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    const transport =
      options.transport ?? (await import("./browser-chromium")).createChromiumTransport();
    const session = await transport(dir, {
      viewportWidth: options.viewportWidth ?? 1280,
      viewportHeight: options.viewportHeight ?? 800,
      allowedPrivateHosts: options.allowedPrivateHosts,
      scale: options.scale === 1 ? 1 : 2,
      onPhase,
    });
    const entry: LiveBrowserSession = {
      session,
      tabs: new Map(),
      driver: "agent",
      lastActivity: clock.now(),
      idleMs,
    };
    session.onDisconnect?.(() => dropDeadSession(key, entry));
    return entry;
  }

  /**
   * A browser that died under the app must stop answering as live: until
   * the idle sweeper noticed (minutes), every tool call and viewer resize
   * would fail or silently do nothing against it. The next call opens fresh.
   */
  function dropDeadSession(key: string, entry: LiveBrowserSession): void {
    if (live.get(key) !== entry) return; // already closed, reset or replaced
    live.delete(key);
    entry.driver = "agent"; // nobody drives a dead browser: waiting actions move on
    release(entry);
    void entry.session.close().catch(() => {});
  }

  function acquireBrowser(profile: string): Promise<LiveBrowserSession> {
    ensureSweeper();
    const entry = live.get(profile);
    if (entry) return Promise.resolve(entry);
    let pending = opening.get(profile);
    if (!pending) {
      let phase: BrowserPhase = "starting";
      let cancelled: { wipe: boolean } | undefined;
      const promise = openSession(profile, (next) => {
        phase = next;
      })
        .then(async (opened) => {
          if (cancelled) {
            // Closed while opening: the browser never becomes live.
            await opened.session.close().catch(() => {});
            if (cancelled.wipe) await opened.session.wipeProfile?.().catch(() => {});
            throw new Error("The browser was closed while it was opening.");
          }
          live.set(profile, opened);
          openErrors.delete(profile);
          return opened;
        })
        .catch((error: unknown) => {
          if (!cancelled) openErrors.set(profile, describeBrowserError(error));
          throw error;
        })
        .finally(() => {
          if (opening.get(profile) === pending) opening.delete(profile);
        });
      pending = {
        promise,
        get phase() {
          return phase;
        },
        cancel(wipe) {
          cancelled = { wipe: wipe || cancelled?.wipe === true };
        },
      };
      opening.set(profile, pending);
    }
    return pending.promise;
  }

  /**
   * The agent's tab: the browser's first tab goes to the first agent, later
   * agents get a new tab each (or share the first where the transport
   * cannot open tabs).
   */
  async function tabIn(entry: LiveBrowserSession, key: string): Promise<BrowserSession> {
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
          if ([...live.values()].includes(entry)) entry.tabs.set(key, tab);
          return tab;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  async function acquire(target: BrowserTarget): Promise<LiveBrowserTab> {
    const entry = await acquireBrowser(target.profile);
    const tab = await tabIn(entry, target.tab);
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

  /** Wake every action tool waiting for this browser's owner to hand it back. */
  function release(entry: LiveBrowserSession) {
    const waiters = handBacks.get(entry);
    if (!waiters) return;
    handBacks.delete(entry);
    for (const wake of waiters) wake();
  }

  /** Resolves when the owner hands the browser back, or after `ms`. */
  function handBack(entry: LiveBrowserSession, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const waiters = handBacks.get(entry) ?? new Set<() => void>();
      handBacks.set(entry, waiters);
      const timer = clock.setTimeout(() => {
        waiters.delete(wake);
        resolve();
      }, ms);
      const wake = () => {
        clock.clearTimeout(timer);
        resolve();
      };
      waiters.add(wake);
    });
  }

  async function closeEntry(
    profile: string,
    entry: LiveBrowserSession,
    wipe: boolean,
  ): Promise<void> {
    entry.driver = "agent";
    release(entry);
    if (live.get(profile) === entry) live.delete(profile);
    await entry.session.close();
    if (wipe) await entry.session.wipeProfile?.();
  }

  const manager: BrowserSessions = {
    profilesDir,
    exemptHosts,
    acquire,
    peek(target) {
      const entry = live.get(target.profile);
      const tab = entry?.tabs.get(target.tab);
      return entry && tab ? { browser: entry, session: tab } : undefined;
    },
    async start(target) {
      openErrors.delete(target.profile);
      const tab = await acquire(target);
      await bringToFront(tab, target.tab);
      return tab;
    },
    openState(target) {
      const pending = opening.get(target.profile);
      if (pending) return { opening: true, phase: pending.phase };
      return { opening: false, error: openErrors.get(target.profile) };
    },
    get: (target) => live.get(target.profile),
    profiles: () => [...live.keys()],
    async readTurn(target) {
      const tab = await acquire(target);
      await bringToFront(tab, target.tab);
      return tab;
    },
    async actionTurn(target) {
      const tab = await acquire(target);
      const entry = tab.browser;
      const deadline = clock.now() + humanWaitMs;
      while (entry.driver === "human") {
        const left = deadline - clock.now();
        if (left <= 0) {
          throw new Error(
            "The owner is driving the browser; wait and retry, or continue without the browser.",
          );
        }
        await handBack(entry, left);
      }
      await bringToFront(tab, target.tab);
      return tab;
    },
    async setDriver(target, driver) {
      const entry = live.get(target.profile);
      if (!entry) return;
      const released = entry.driver === "human" && driver === "agent";
      entry.driver = driver;
      if (driver === "human") entry.lastActivity = clock.now();
      if (!released) return;
      // The owner may have opened or switched tabs while driving; the agent
      // they hand back to continues from whichever tab they left in front.
      entry.front = undefined;
      const tab = entry.tabs.get(target.tab);
      if (tab) {
        await tab.adoptActiveTab?.().catch(() => {});
        entry.front = target.tab;
      }
      release(entry);
    },
    async close(target, { wipeProfile = false } = {}) {
      const pending = opening.get(target.profile);
      if (pending) {
        pending.cancel(wipeProfile);
        await pending.promise.catch(() => undefined);
      }
      const entry = live.get(target.profile);
      if (entry) await closeEntry(target.profile, entry, wipeProfile);
    },
    async closeTab(target) {
      const entry = live.get(target.profile);
      const tab = entry?.tabs.get(target.tab);
      if (!entry || !tab) return;
      entry.tabs.delete(target.tab);
      if (entry.front === target.tab) entry.front = undefined;
      if (entry.tabs.size === 0) {
        await closeEntry(target.profile, entry, false);
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
    async closeAll() {
      for (const pending of opening.values()) pending.cancel(false);
      await Promise.allSettled([...opening.values()].map((pending) => pending.promise));
      const entries = [...live.entries()];
      live.clear();
      await Promise.allSettled(entries.map(([, entry]) => closeEntry("", entry, false)));
      openErrors.clear();
      if (sweeper !== undefined) {
        clock.clearInterval(sweeper);
        sweeper = undefined;
      }
    },
    async fillSecret(target, fill) {
      const tab = live.get(target.profile)?.tabs.get(target.tab);
      if (!tab?.fillSecret) throw new Error("The bot's browser is not open any more.");
      return tab.fillSecret(fill);
    },
    async tabOrigin(target) {
      const tab = live.get(target.profile)?.tabs.get(target.tab);
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
