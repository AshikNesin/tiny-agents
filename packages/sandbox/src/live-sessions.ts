import { callerSeesRejection, survived } from "./failures";

export type LiveDriver = "agent" | "human";

export type LivePhase = "installing" | "starting";

export type LiveOpenState =
  | { opening: true; phase: LivePhase }
  | { opening: false; error?: string };

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

export interface LiveEntry {
  driver: LiveDriver;
  lastActivity: number;
  idleMs: number;
  ownerInputAt?: number;
}

interface LiveSurface {
  close(): Promise<void>;
  onDisconnect?(listener: () => void): void;
}

export interface LiveSessionsOptions<U extends LiveSurface, S extends LiveEntry> {
  clock: LiveClock;
  idleMs: number;
  humanDriverWaitMs: number;
  launch(profile: string, onPhase: (phase: LivePhase) => void): Promise<U>;
  enter(surface: U, base: LiveEntry): S;
  surfaceOf(entry: S): U;
  wipe(profile: string): Promise<void>;
  checkProfile?(profile: string): void;
  touchOnOpen: boolean;
  touchOnHandBack: boolean;
  openWaitsForClose: boolean;
  sweepReleases: boolean;
  wipeCancelledOpen: boolean;
  closeErrors: "throw" | "swallow";
  closedWhileOpening: string;
  describeOpenError(error: unknown): string;
  ownerDriving(kind: "read" | "act"): Error;
  onRelease?(entry: S): void;
  handBackIdle(profile: string): void;
}

interface LiveTurn<S, T> {
  pick?: (entry: S) => Promise<T>;
  finish?: (picked: T) => Promise<void> | void;
}

export interface LiveSessions<S extends LiveEntry> {
  open(profile: string): Promise<S>;
  peek(profile: string): S | undefined;
  profiles(): string[];
  openState(profile: string): LiveOpenState;
  forgetOpenError(profile: string): void;
  driver(profile: string): LiveDriver | undefined;
  takeOver(profile: string): S | undefined;
  ownerInput(profile: string): void;
  handBack(profile: string, wake?: boolean): S | undefined;
  release(entry: S): void;
  read<T = S>(profile: string, turn: LiveTurn<S, T> & { allowWhileHuman: boolean }): Promise<T>;
  act<T = S>(profile: string, turn?: LiveTurn<S, T>): Promise<T>;
  waitForHandBack(entry: S, ms: number): Promise<boolean>;
  drop(profile: string, entry: S): void;
  dispose(profile: string, entry: S): Promise<void>;
  close(profile: string, options?: { wipe?: boolean }): Promise<void>;
  closeAll(): Promise<void>;
}

const IDLE_SWEEP_MS = 60_000;
const OWNER_IDLE_MS = 2 * 60_000;

interface Opening<S> {
  promise: Promise<S>;
  readonly phase: LivePhase;
  cancel(wipe: boolean): void;
}

async function settle(promise: Promise<void>): Promise<void> {
  await promise;
}

export function createLiveSessions<U extends LiveSurface, S extends LiveEntry>(
  options: LiveSessionsOptions<U, S>,
): LiveSessions<S> {
  const { clock } = options;
  const live = new Map<string, S>();
  const opening = new Map<string, Opening<S>>();
  const closing = new Map<string, Promise<void>>();
  const openErrors = new Map<string, string>();
  const handBacks = new WeakMap<S, Set<() => void>>();
  let sweeper: unknown;

  function ensureSweeper() {
    if (sweeper !== undefined) return;
    sweeper = clock.setInterval(() => {
      const now = clock.now();
      for (const [key, entry] of live) {
        if (entry.driver === "human") {
          const input = entry.ownerInputAt;
          if (input !== undefined && input < now - OWNER_IDLE_MS) options.handBackIdle(key);
          continue;
        }
        if (entry.lastActivity < now - entry.idleMs) {
          live.delete(key);
          if (options.sweepReleases) release(entry);
          void options
            .surfaceOf(entry)
            .close()
            .catch(survived(`closing the idle session ${key}`));
        }
      }
    }, IDLE_SWEEP_MS);
  }

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
    if (live.get(profile) !== entry) return;
    live.delete(profile);
    entry.driver = "agent";
    release(entry);
    void options
      .surfaceOf(entry)
      .close()
      .catch(survived(`closing the dropped session ${profile}`));
  }

  function dispose(profile: string, entry: S): Promise<void> {
    entry.driver = "agent";
    release(entry);
    if (live.get(profile) === entry) live.delete(profile);
    const closed = options.surfaceOf(entry).close();
    return options.closeErrors === "swallow"
      ? closed.catch(survived(`closing the session ${profile}`))
      : settle(closed);
  }

  async function closeProfile(profile: string, wipe: boolean): Promise<void> {
    const pending = opening.get(profile);
    if (pending) {
      pending.cancel(wipe);
      await pending.promise.catch(callerSeesRejection());
    }
    const entry = live.get(profile);
    if (entry) await dispose(profile, entry);
    openErrors.delete(profile);
    if (wipe) await options.wipe(profile);
  }

  async function closeTracked(profile: string, wipe: boolean): Promise<void> {
    const done = closeProfile(profile, wipe);
    const settled = done.catch(callerSeesRejection());
    closing.set(profile, settled);
    try {
      await done;
    } finally {
      if (closing.get(profile) === settled) closing.delete(profile);
    }
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
            await surface
              .close()
              .catch(survived(`closing the session ${profile} cancelled while opening`));
            if (options.wipeCancelledOpen && cancelled.wipe) {
              await options
                .wipe(profile)
                .catch(survived(`wiping ${profile} after its open was cancelled`));
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
    ownerInput(profile) {
      const entry = live.get(profile);
      if (entry?.driver === "human") entry.ownerInputAt = clock.now();
    },
    handBack(profile, wake = true) {
      const entry = live.get(profile);
      if (!entry) return undefined;
      const released = entry.driver === "human";
      entry.driver = "agent";
      entry.ownerInputAt = undefined;
      if (options.touchOnHandBack) entry.lastActivity = clock.now();
      if (!released) return undefined;
      if (wake) release(entry);
      return entry;
    },
    release,
    async read<T>(
      profile: string,
      { pick, finish, allowWhileHuman }: LiveTurn<S, T> & { allowWhileHuman: boolean },
    ) {
      const entry = await open(profile);
      const picked = pick ? await pick(entry) : (entry as unknown as T);
      if (!allowWhileHuman && entry.driver === "human") throw options.ownerDriving("read");
      const finishing = finish?.(picked);
      if (finishing) await finishing;
      return picked;
    },
    async act<T>(profile: string, { pick, finish }: LiveTurn<S, T> = {}) {
      const entry = await open(profile);
      const picked = pick ? await pick(entry) : (entry as unknown as T);
      const deadline = clock.now() + options.humanDriverWaitMs;
      while (entry.driver === "human") {
        const left = deadline - clock.now();
        if (left <= 0) throw options.ownerDriving("act");
        await waitForHandBack(entry, left);
      }
      const finishing = finish?.(picked);
      if (finishing) await finishing;
      return picked;
    },
    waitForHandBack,
    drop,
    dispose,
    close: (profile, { wipe = false } = {}) =>
      options.openWaitsForClose ? closeTracked(profile, wipe) : closeProfile(profile, wipe),
    async closeAll() {
      for (const pending of opening.values()) pending.cancel(false);
      await Promise.allSettled([...opening.values()].map((pending) => pending.promise));
      const entries = [...live.entries()];
      live.clear();
      await Promise.allSettled(entries.map(async ([profile, entry]) => dispose(profile, entry)));
      openErrors.clear();
      if (sweeper !== undefined) {
        clock.clearInterval(sweeper);
        sweeper = undefined;
      }
    },
  };
}
