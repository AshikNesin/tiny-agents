/**
 * One generic manager for live sessions (docs/rewrite/README.md §4.2): the
 * browser (`browser-sessions.ts`) and the computer (`computer-sessions.ts`)
 * are thin instances of it. It owns the lifecycle rules both share:
 * - lazy open per profile; concurrent callers share one launch;
 * - a close cancels an in-flight open, so a reset or wipe never comes back
 *   as a session that finished opening after it;
 * - the driver flag: reads may be refused and actions wait, bounded, while
 *   the owner drives; a hand-back wakes every waiter;
 * - the idle sweep, on an injectable clock (an open takeover is activity);
 * - dropping a session that died under the app, so the next call reopens;
 * - `peek`, which never launches: planning a tool call must not start one.
 *
 * Where the two managers differed before they shared this, the difference is
 * an option here, each with its reason in the §4.2 drift table. Nothing
 * outside this package imports it yet.
 */

/** Who drives a session: the bot (`agent`, the wire value routes and entries carry) or the owner. */
export type LiveDriver = "agent" | "human";

/** Where a session is while it opens; `installing` is the one-time VM setup. */
export type LivePhase = "installing" | "starting";

export type LiveOpenState =
  | { opening: true; phase: LivePhase }
  | { opening: false; error?: string };

/** Timers and the clock, injectable so the idle sweep and driver wait are testable. */
export interface LiveClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realClock: LiveClock = {
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

/** What every live session carries; each transport adds its surface and bookkeeping. */
export interface LiveEntry {
  driver: LiveDriver;
  lastActivity: number;
  /** This session's idle close window (ms), from the manager options. */
  idleMs: number;
}

/** What the manager needs from the thing a session drives (a browser, a desktop). */
interface LiveSurface {
  close(): Promise<void>;
  /** Called once if it dies under the app, never after `close()`. */
  onDisconnect?(listener: () => void): void;
}

export interface LiveSessionsOptions<U extends LiveSurface, S extends LiveEntry> {
  clock: LiveClock;
  idleMs: number;
  /** Bound for how long actions wait while the owner drives (ms). */
  humanDriverWaitMs: number;
  /** Start the surface for a profile, reporting slow phases. */
  launch(profile: string, onPhase: (phase: LivePhase) => void): Promise<U>;
  /** The live entry for a surface that just opened (`base` is driver, activity, idle window). */
  enter(surface: U, base: LiveEntry): S;
  surfaceOf(entry: S): U;
  /** Delete the profile's persisted state. Its errors fail the close. */
  wipe(profile: string): Promise<void>;
  /** Refuse a profile before anything starts (no sweep, no open error). Absent: `launch` checks. */
  checkProfile?(profile: string): void;
  /** An open of a live session counts as activity at once (else the caller touches when ready). */
  touchOnOpen: boolean;
  /** A hand-back (any non-takeover driver set) counts as activity. */
  touchOnHandBack: boolean;
  /** An open waits for a close in progress on the profile (a wipe never races a launch). */
  openWaitsForClose: boolean;
  /** A close with wipe that cancels an open also wipes as the open lands (errors ignored). */
  wipeCancelledOpen: boolean;
  /** Whether a surface's failing `close()` fails `close`/`dispose`. */
  closeErrors: "throw" | "swallow";
  /** The error an open cancelled by a close rejects with. */
  closedWhileOpening: string;
  /** The open error the status route shows until the next attempt. */
  describeOpenError(error: unknown): string;
  /** The error for a refused read, or an action whose wait ran out. */
  ownerDriving(kind: "read" | "act"): Error;
  /** Bookkeeping cleared whenever waiters are released (before they wake). */
  onRelease?(entry: S): void;
}

export interface LiveSessions<S extends LiveEntry> {
  /** The profile's live session, opening it if needed (one shared launch). */
  open(profile: string): Promise<S>;
  /** The live session, never opening one. Undefined while it opens. */
  peek(profile: string): S | undefined;
  /** Profiles with a live session. */
  profiles(): string[];
  /** What the status route reports for a session that is not live (yet). */
  openState(profile: string): LiveOpenState;
  /** Forget the last open failure (an owner's explicit start). */
  forgetOpenError(profile: string): void;
  driver(profile: string): LiveDriver | undefined;
  /** The owner (or a bot's request) takes the wheel; the session if live. */
  takeOver(profile: string): S | undefined;
  /** Back to the bot; `beforeRelease` runs before waiters wake, only if the owner was driving. */
  handBack(profile: string, beforeRelease?: (entry: S) => Promise<void>): Promise<void>;
  /**
   * A read: open, `pick` what it works on, then refuse while the owner
   * drives unless `allowWhileHuman`.
   */
  read<T>(
    profile: string,
    pick: (entry: S) => Promise<T>,
    opts: { allowWhileHuman: boolean },
  ): Promise<T>;
  /** An action: open, `pick`, then wait while the owner drives (bounded). */
  act<T>(profile: string, pick: (entry: S) => Promise<T>): Promise<T>;
  /** Resolves true when the owner hands back, false after `ms`. */
  waitForHandBack(entry: S, ms: number): Promise<boolean>;
  /** The session died under the app: forget it (if still current) so the next call reopens. */
  drop(profile: string, entry: S): void;
  /** Close one live entry: wake waiters, forget it, close its surface. */
  dispose(profile: string, entry: S): Promise<void>;
  /** Close (and with `wipe`, delete) the profile's session, including one still opening. */
  close(profile: string, options?: { wipe?: boolean }): Promise<void>;
  /** Graceful shutdown: cancel opens, close every session, stop the sweep. */
  closeAll(): Promise<void>;
}

const IDLE_SWEEP_MS = 60_000;

interface Opening<S> {
  promise: Promise<S>;
  readonly phase: LivePhase;
  /** A close arrived meanwhile: the opened session closes at once. */
  cancel(wipe: boolean): void;
}

export function createLiveSessions<U extends LiveSurface, S extends LiveEntry>(
  options: LiveSessionsOptions<U, S>,
): LiveSessions<S> {
  const { clock } = options;
  const live = new Map<string, S>();
  const opening = new Map<string, Opening<S>>();
  /** Closes in progress, which an open waits for when `openWaitsForClose`. */
  const closing = new Map<string, Promise<void>>();
  /** Last open failure per profile, surfaced by the status route until the next attempt. */
  const openErrors = new Map<string, string>();
  /** Waiters for the owner's hand-back. */
  const handBacks = new WeakMap<S, Set<() => void>>();
  let sweeper: unknown;

  function ensureSweeper() {
    if (sweeper !== undefined) return;
    sweeper = clock.setInterval(() => {
      const now = clock.now();
      for (const [key, entry] of live) {
        if (entry.driver === "human") continue; // an open takeover is activity
        if (entry.lastActivity < now - entry.idleMs) {
          live.delete(key);
          release(entry);
          void options
            .surfaceOf(entry)
            .close()
            .catch(() => {});
        }
      }
    }, IDLE_SWEEP_MS);
  }

  /** Wake every waiter on this session's hand-back. */
  function release(entry: S) {
    options.onRelease?.(entry);
    const waiters = handBacks.get(entry);
    if (!waiters) return;
    handBacks.delete(entry);
    for (const wake of waiters) wake();
  }

  function waitForHandBack(entry: S, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const waiters = handBacks.get(entry) ?? new Set<() => void>();
      handBacks.set(entry, waiters);
      const timer = clock.setTimeout(() => {
        waiters.delete(wake);
        resolve(false);
      }, ms);
      const wake = () => {
        clock.clearTimeout(timer);
        resolve(true);
      };
      waiters.add(wake);
    });
  }

  function drop(profile: string, entry: S): void {
    if (live.get(profile) !== entry) return; // already closed, reset or replaced
    live.delete(profile);
    entry.driver = "agent"; // nobody drives a dead session: waiting actions move on
    release(entry);
    void options
      .surfaceOf(entry)
      .close()
      .catch(() => {});
  }

  async function dispose(profile: string, entry: S): Promise<void> {
    entry.driver = "agent";
    release(entry);
    if (live.get(profile) === entry) live.delete(profile);
    const closed = options.surfaceOf(entry).close();
    await (options.closeErrors === "swallow" ? closed.catch(() => {}) : closed);
  }

  function open(profile: string): Promise<S> {
    if (options.checkProfile) {
      try {
        options.checkProfile(profile);
      } catch (error) {
        return Promise.reject(error);
      }
    }
    ensureSweeper();
    const entry = live.get(profile);
    if (entry) {
      if (options.touchOnOpen) entry.lastActivity = clock.now();
      return Promise.resolve(entry);
    }
    let pending = opening.get(profile);
    if (!pending) {
      let phase: LivePhase = "starting";
      let cancelled: { wipe: boolean } | undefined;
      const onPhase = (next: LivePhase) => {
        phase = next;
      };
      const launched = options.openWaitsForClose
        ? (closing.get(profile) ?? Promise.resolve()).then(() => options.launch(profile, onPhase))
        : options.launch(profile, onPhase);
      const promise = launched
        .then(async (surface) => {
          if (cancelled) {
            // Closed while opening: the session never becomes live.
            await surface.close().catch(() => {});
            if (options.wipeCancelledOpen && cancelled.wipe) {
              await options.wipe(profile).catch(() => {});
            }
            throw new Error(options.closedWhileOpening);
          }
          const opened = options.enter(surface, {
            driver: "agent",
            lastActivity: clock.now(),
            idleMs: options.idleMs,
          });
          live.set(profile, opened);
          openErrors.delete(profile);
          surface.onDisconnect?.(() => drop(profile, opened));
          return opened;
        })
        .catch((error: unknown) => {
          if (!cancelled) openErrors.set(profile, options.describeOpenError(error));
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

  return {
    open,
    peek: (profile) => live.get(profile),
    profiles: () => [...live.keys()],
    openState(profile) {
      const pending = opening.get(profile);
      if (pending) return { opening: true, phase: pending.phase };
      return { opening: false, error: openErrors.get(profile) };
    },
    forgetOpenError: (profile) => void openErrors.delete(profile),
    driver: (profile) => live.get(profile)?.driver,
    takeOver(profile) {
      const entry = live.get(profile);
      if (!entry) return undefined;
      entry.driver = "human";
      entry.lastActivity = clock.now();
      return entry;
    },
    async handBack(profile, beforeRelease) {
      const entry = live.get(profile);
      if (!entry) return;
      const released = entry.driver === "human";
      entry.driver = "agent";
      if (options.touchOnHandBack) entry.lastActivity = clock.now();
      if (!released) return;
      if (beforeRelease) await beforeRelease(entry);
      release(entry);
    },
    async read(profile, pick, { allowWhileHuman }) {
      const entry = await open(profile);
      const picked = await pick(entry);
      if (!allowWhileHuman && entry.driver === "human") throw options.ownerDriving("read");
      return picked;
    },
    async act(profile, pick) {
      const entry = await open(profile);
      const picked = await pick(entry);
      const deadline = clock.now() + options.humanDriverWaitMs;
      while (entry.driver === "human") {
        const left = deadline - clock.now();
        if (left <= 0) throw options.ownerDriving("act");
        await waitForHandBack(entry, left);
      }
      return picked;
    },
    waitForHandBack,
    drop,
    dispose,
    async close(profile, { wipe = false } = {}) {
      const done = (async () => {
        const pending = opening.get(profile);
        if (pending) {
          pending.cancel(wipe);
          await pending.promise.catch(() => undefined);
        }
        const entry = live.get(profile);
        if (entry) await dispose(profile, entry);
        openErrors.delete(profile);
        if (wipe) await options.wipe(profile);
      })();
      const settled = done.catch(() => undefined);
      closing.set(profile, settled);
      try {
        await done;
      } finally {
        if (closing.get(profile) === settled) closing.delete(profile);
      }
    },
    async closeAll() {
      for (const pending of opening.values()) pending.cancel(false);
      await Promise.allSettled([...opening.values()].map((pending) => pending.promise));
      const entries = [...live.entries()];
      live.clear();
      await Promise.allSettled(entries.map(([profile, entry]) => dispose(profile, entry)));
      openErrors.clear();
      if (sweeper !== undefined) {
        clock.clearInterval(sweeper);
        sweeper = undefined;
      }
    },
  };
}
