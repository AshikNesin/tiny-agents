/**
 * Computer sessions (issue #108): the one place that knows which desktops
 * are live. Created once per server process and handed to both the computer
 * toolkit (tool calls) and the app's routes (status, "Open computer",
 * takeover, reset, the VNC bridge), like `browser-sessions.ts`.
 *
 * One desktop per profile (a bot's browser profile: `shared`, or its own),
 * so bots on the shared profile share one screen. The manager owns:
 * - lazy open per profile; concurrent callers share one launch; a close
 *   cancels an in-flight open;
 * - the driver flag: action tools wait while the owner drives (bounded),
 *   read tools refuse outright so nothing the owner types reaches the model;
 * - the bot's own takeover request, which the owner's hand-back answers;
 * - the idle sweep, on an injectable clock (an open takeover is activity);
 * - dropping a desktop that died under the app, so the next call relaunches.
 */
import type { Duplex } from "node:stream";
import type { BrowserClock } from "./browser-sessions";

/** Where a desktop is while it opens; `installing` is the one-time VM setup. */
export type ComputerPhase = "installing" | "starting";

export type ComputerDriver = "agent" | "human";

export type MouseButton = "left" | "right" | "middle";
export type ScrollDirection = "up" | "down" | "left" | "right";
export type KeyModifier = "ctrl" | "shift" | "alt" | "super";

/** One top-level window as `wmctrl -l -x` reports it. */
export interface ComputerWindow {
  /** `0x…` X window id, what focus and close take. */
  id: string;
  /** WM_CLASS as `instance.Class` ("mousepad.Mousepad"). */
  windowClass: string;
  title: string;
  active: boolean;
}

/** A desktop entry the bot can open. */
export interface ComputerApp {
  /** Desktop entry id without `.desktop` ("org.xfce.mousepad"). */
  id: string;
  name: string;
}

/** What `typeSecret` checks the active window against right before typing. */
export interface WindowBinding {
  /** Matches either part of WM_CLASS, case-insensitively. */
  windowClass: string;
  /** Must appear in the active window's title, case-insensitively. Empty: any title. */
  title?: string;
}

/** The desktop changed under a tool: its active window is not the bound one. */
export class WindowMismatchError extends Error {
  constructor(readonly active: string) {
    super(`The active window is ${active || "unknown"}, not the one this secret is bound to.`);
    this.name = "WindowMismatchError";
  }
}

/** The desktop is gone (VM restarted, X server killed): the next call starts a fresh one. */
export class DesktopGoneError extends Error {
  constructor(message = "The computer's desktop stopped running.") {
    super(message);
    this.name = "DesktopGoneError";
  }
}

/** The owner drives the computer: reads are refused, actions waited out too long. */
export class OwnerDrivingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerDrivingError";
  }
}

/**
 * The computer port: one live desktop. Production is xdotool/scrot over SSH
 * (`computer-x11.ts`); tests substitute fakes. Coordinates are desktop
 * pixels, the same pixels a screenshot has.
 */
export interface ComputerDesktop {
  readonly width: number;
  readonly height: number;
  /** Present when the desktop is served over VNC (always, on the VM). */
  vnc?: { openStream(): Promise<Duplex> };
  /** JPEG of the whole desktop, or of `region` at full resolution. */
  screenshot(region?: { x: number; y: number; width: number; height: number }): Promise<Buffer>;
  cursorPosition(): Promise<{ x: number; y: number }>;
  click(
    x: number,
    y: number,
    options: { button: MouseButton; count: number; modifiers: KeyModifier[] },
  ): Promise<void>;
  move(x: number, y: number): Promise<void>;
  drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void>;
  scroll(x: number, y: number, direction: ScrollDirection, amount: number): Promise<void>;
  /** Text travels on stdin, never on a command line. */
  type(text: string): Promise<void>;
  /** xdotool key names, already validated (`normalizeKeys`). */
  key(chords: string[], repeat: number): Promise<void>;
  listWindows(): Promise<ComputerWindow[]>;
  focusWindow(id: string): Promise<void>;
  closeWindow(id: string): Promise<void>;
  listApps(): Promise<ComputerApp[]>;
  openApp(id: string): Promise<void>;
  clipboardGet(): Promise<string>;
  /** Text travels on stdin. */
  clipboardSet(text: string): Promise<void>;
  /**
   * Type a vault value into the active window, checked against `binding` on
   * the VM in the same exec right before typing. Throws
   * `WindowMismatchError` when another window is in front.
   */
  typeSecret(text: string, binding: WindowBinding): Promise<void>;
  /** Call `listener` once if the desktop dies under the app; never after `close()`. */
  onDisconnect?(listener: () => void): void;
  /** Stop the desktop on the VM. */
  close(): Promise<void>;
}

export interface OpenDesktopOptions {
  width: number;
  height: number;
  onPhase?: (phase: ComputerPhase) => void;
}

/** How desktops are made and wiped: production is the sandbox VM. */
export interface ComputerTransport {
  open(profile: string, options: OpenDesktopOptions): Promise<ComputerDesktop>;
  /** Delete a profile's settings and app state (its desktop is closed first). */
  wipe(profile: string): Promise<void>;
}

/** One live desktop: shared by every bot whose profile names it. */
export interface LiveComputer {
  desktop: ComputerDesktop;
  driver: ComputerDriver;
  lastActivity: number;
  idleMs: number;
  /** Set while a bot asked the owner to take over (`computer_request_takeover`). */
  takeover?: { reason: string; since: number };
}

export type ComputerOpenState =
  | { opening: true; phase: ComputerPhase }
  | { opening: false; error?: string };

export interface ComputerSessionsOptions {
  transport: ComputerTransport;
  width?: number;
  height?: number;
  /** Idle close in minutes (default 10). */
  idleMinutes?: number;
  /** Bound for how long action tools wait while the owner drives (ms, default 10 min). */
  humanDriverWaitMs?: number;
  clock?: BrowserClock;
}

export interface ComputerSessions {
  readonly width: number;
  readonly height: number;
  /** The profile's live desktop, opening it if needed. */
  acquire(profile: string): Promise<LiveComputer>;
  /** The live desktop, never opening one. */
  get(profile: string): LiveComputer | undefined;
  /** Open without a tool call (the owner's "Open computer"). */
  start(profile: string): Promise<LiveComputer>;
  openState(profile: string): ComputerOpenState;
  profiles(): string[];
  /** Read tools: the desktop, refused while the owner drives. */
  readTurn(profile: string): Promise<LiveComputer>;
  /** Action tools: wait while the owner drives (bounded), then the desktop. */
  actionTurn(profile: string): Promise<LiveComputer>;
  /** Flip the driver; handing back wakes waiting tools and ends a takeover request. */
  setDriver(profile: string, driver: ComputerDriver): Promise<void>;
  /**
   * The bot asks the owner to take over: the driver becomes `human` with the
   * reason recorded, and this resolves `released` once the owner hands back,
   * or `timeout` after `ms` (the driver flag then stays with the owner).
   */
  requestTakeover(profile: string, reason: string, ms: number): Promise<"released" | "timeout">;
  /** A tool found the desktop gone: forget it so the next call opens a fresh one. */
  drop(profile: string, desktop: ComputerDesktop): void;
  /** Close (and with `wipe`, delete the profile of) the desktop, including one still opening. */
  close(profile: string, options?: { wipe?: boolean }): Promise<void>;
  closeAll(): Promise<void>;
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

const IDLE_SWEEP_MS = 60_000;

/** What a tool says while the owner drives: the bot learns to wait or move on. */
export const OWNER_DRIVING =
  "The owner is driving the computer, so screenshots are paused. Wait for them to hand it back, or continue without the computer.";

/** A `computer_request_takeover` call as the chat shows it. */
export interface ChatTakeover {
  status: "pending" | "released" | "expired";
  reason: string;
}

/** The takeover a tool call's details carry (the request's card), if any. */
export function takeoverOf(details: unknown): ChatTakeover | undefined {
  const own = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const takeover = own.takeover as Record<string, unknown> | undefined;
  if (!takeover || typeof takeover !== "object") return undefined;
  const status = takeover.status;
  if (status !== "pending" && status !== "released" && status !== "expired") return undefined;
  return { status, reason: typeof takeover.reason === "string" ? takeover.reason : "" };
}

const managers = new Set<ComputerSessions>();

interface Opening {
  promise: Promise<LiveComputer>;
  readonly phase: ComputerPhase;
  cancel(wipe: boolean): void;
}

export function createComputerSessions(options: ComputerSessionsOptions): ComputerSessions {
  const clock = options.clock ?? realClock;
  const width = options.width ?? 1280;
  const height = options.height ?? 800;
  const idleMs = (options.idleMinutes ?? 10) * 60_000;
  const humanWaitMs = options.humanDriverWaitMs ?? 10 * 60_000;
  const live = new Map<string, LiveComputer>();
  const opening = new Map<string, Opening>();
  const openErrors = new Map<string, string>();
  const handBacks = new WeakMap<LiveComputer, Set<() => void>>();
  let sweeper: unknown;

  const checkProfile = (profile: string) => {
    if (!/^[\w-]{1,64}$/.test(profile)) throw new Error(`Invalid computer profile "${profile}".`);
  };

  function ensureSweeper() {
    if (sweeper !== undefined) return;
    sweeper = clock.setInterval(() => {
      const now = clock.now();
      for (const [key, entry] of live) {
        if (entry.driver === "human") continue; // an open takeover is activity
        if (entry.lastActivity < now - entry.idleMs) {
          live.delete(key);
          release(entry);
          void entry.desktop.close().catch(() => {});
        }
      }
    }, IDLE_SWEEP_MS);
  }

  function release(entry: LiveComputer) {
    entry.takeover = undefined;
    const waiters = handBacks.get(entry);
    if (!waiters) return;
    handBacks.delete(entry);
    for (const wake of waiters) wake();
  }

  /** Resolves true when the owner hands back, false after `ms`. */
  function handBack(entry: LiveComputer, ms: number): Promise<boolean> {
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

  function dropDead(profile: string, entry: LiveComputer) {
    if (live.get(profile) !== entry) return;
    live.delete(profile);
    entry.driver = "agent";
    release(entry);
    void entry.desktop.close().catch(() => {});
  }

  function acquire(profile: string): Promise<LiveComputer> {
    try {
      checkProfile(profile);
    } catch (error) {
      return Promise.reject(error);
    }
    ensureSweeper();
    const entry = live.get(profile);
    if (entry) {
      entry.lastActivity = clock.now();
      return Promise.resolve(entry);
    }
    let pending = opening.get(profile);
    if (!pending) {
      let phase: ComputerPhase = "starting";
      let cancelled: { wipe: boolean } | undefined;
      const promise = options.transport
        .open(profile, { width, height, onPhase: (next) => (phase = next) })
        .then(async (desktop) => {
          if (cancelled) {
            await desktop.close().catch(() => {});
            if (cancelled.wipe) await options.transport.wipe(profile).catch(() => {});
            throw new Error("The computer was closed while it was starting.");
          }
          const opened: LiveComputer = {
            desktop,
            driver: "agent",
            lastActivity: clock.now(),
            idleMs,
          };
          live.set(profile, opened);
          openErrors.delete(profile);
          desktop.onDisconnect?.(() => dropDead(profile, opened));
          return opened;
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            openErrors.set(profile, error instanceof Error ? error.message : String(error));
          }
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

  const manager: ComputerSessions = {
    width,
    height,
    acquire,
    get: (profile) => live.get(profile),
    async start(profile) {
      openErrors.delete(profile);
      return acquire(profile);
    },
    openState(profile) {
      const pending = opening.get(profile);
      if (pending) return { opening: true, phase: pending.phase };
      return { opening: false, error: openErrors.get(profile) };
    },
    profiles: () => [...live.keys()],
    async readTurn(profile) {
      const entry = await acquire(profile);
      if (entry.driver === "human") throw new OwnerDrivingError(OWNER_DRIVING);
      return entry;
    },
    async actionTurn(profile) {
      const entry = await acquire(profile);
      const deadline = clock.now() + humanWaitMs;
      while (entry.driver === "human") {
        const left = deadline - clock.now();
        if (left <= 0) {
          throw new OwnerDrivingError(
            "The owner is driving the computer; nothing was done. Wait and retry, or continue without the computer.",
          );
        }
        await handBack(entry, left);
      }
      entry.lastActivity = clock.now();
      return entry;
    },
    async setDriver(profile, driver) {
      const entry = live.get(profile);
      if (!entry) return;
      const released = entry.driver === "human" && driver === "agent";
      entry.driver = driver;
      entry.lastActivity = clock.now();
      if (released) release(entry);
    },
    async requestTakeover(profile, reason, ms) {
      const entry = await acquire(profile);
      // Closed or reset between the open and now: nobody is driving it.
      if (live.get(profile) !== entry) return "released";
      entry.driver = "human";
      entry.takeover = { reason, since: clock.now() };
      entry.lastActivity = clock.now();
      return (await handBack(entry, ms)) ? "released" : "timeout";
    },
    drop(profile, desktop) {
      const entry = live.get(profile);
      if (entry?.desktop === desktop) dropDead(profile, entry);
    },
    async close(profile, { wipe = false } = {}) {
      const pending = opening.get(profile);
      if (pending) {
        pending.cancel(wipe);
        await pending.promise.catch(() => undefined);
      }
      const entry = live.get(profile);
      if (entry) {
        live.delete(profile);
        entry.driver = "agent";
        release(entry);
        await entry.desktop.close().catch(() => {});
      }
      openErrors.delete(profile);
      if (wipe) await options.transport.wipe(profile);
    },
    async closeAll() {
      for (const pending of opening.values()) pending.cancel(false);
      await Promise.allSettled([...opening.values()].map((pending) => pending.promise));
      const entries = [...live.values()];
      live.clear();
      for (const entry of entries) {
        entry.driver = "agent";
        release(entry);
      }
      await Promise.allSettled(entries.map((entry) => entry.desktop.close()));
      openErrors.clear();
      if (sweeper !== undefined) {
        clock.clearInterval(sweeper);
        sweeper = undefined;
      }
    },
  };
  managers.add(manager);
  return manager;
}

/** Graceful shutdown: close every desktop of every manager this process created. */
export async function closeAllComputerSessions(): Promise<void> {
  await Promise.allSettled([...managers].map((manager) => manager.closeAll()));
}
