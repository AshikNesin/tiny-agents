/**
 * Computer sessions (issue #108): the one place that knows which desktops
 * are live. Created once per server process and handed to both the computer
 * toolkit (tool calls) and the app's routes (status, "Open computer",
 * takeover, reset, the VNC bridge), like `browser-sessions.ts`.
 *
 * One desktop per profile (a bot's browser profile: `shared`, or its own),
 * so bots on the shared profile share one screen. The lifecycle rules (lazy
 * shared open, cancel-on-close, the driver flag, the idle sweep, dropping a
 * desktop that died) are `LiveSessions`' (`live-sessions.ts`). This instance
 * adds the bot's own takeover request, which the owner's hand-back answers.
 * Its options keep the computer's side of the drift (docs/rewrite/README.md
 * §4.2): read tools refuse outright while the owner drives, so nothing the
 * owner types reaches the model, and the errors are `OwnerDrivingError`.
 */
import type { Duplex } from "node:stream";
import { VaultTargetMovedError } from "./vault-target";
import type { BrowserClock } from "./browser-sessions";
import {
  createLiveSessions,
  realClock,
  type LiveDriver,
  type LiveOpenState,
  type LivePhase,
} from "./live-sessions";

/** Where a desktop is while it opens; `installing` is the one-time VM setup. */
type ComputerPhase = LivePhase;

type ComputerDriver = LiveDriver;

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

/** The desktop changed under a tool: its active window (`actual`) is not the bound one. */
export class WindowMismatchError extends VaultTargetMovedError {
  constructor(active: string) {
    super(
      active,
      `The active window is ${active || "unknown"}, not the one this secret is bound to.`,
      "active window changed before typing",
    );
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

interface OpenDesktopOptions {
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

type ComputerOpenState = LiveOpenState;

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

/** What a tool says while the owner drives: the bot learns to wait or move on. */
const OWNER_DRIVING =
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

export function createComputerSessions(options: ComputerSessionsOptions): ComputerSessions {
  const clock = options.clock ?? realClock;
  const width = options.width ?? 1280;
  const height = options.height ?? 800;

  const live = createLiveSessions<ComputerDesktop, LiveComputer>({
    clock,
    idleMs: (options.idleMinutes ?? 10) * 60_000,
    humanDriverWaitMs: options.humanDriverWaitMs ?? 10 * 60_000,
    launch: (profile, onPhase) => options.transport.open(profile, { width, height, onPhase }),
    enter: (desktop, base) => ({ desktop, ...base }),
    surfaceOf: (entry) => entry.desktop,
    wipe: (profile) => options.transport.wipe(profile),
    checkProfile(profile) {
      if (!/^[\w-]{1,64}$/.test(profile)) throw new Error(`Invalid computer profile "${profile}".`);
    },
    touchOnOpen: true,
    touchOnHandBack: true,
    openWaitsForClose: false,
    wipeCancelledOpen: true,
    closeErrors: "swallow",
    closedWhileOpening: "The computer was closed while it was starting.",
    describeOpenError: (error) => (error instanceof Error ? error.message : String(error)),
    // Reads are refused so nothing the owner types reaches the model (U11).
    ownerDriving: (kind) =>
      new OwnerDrivingError(
        kind === "read"
          ? OWNER_DRIVING
          : "The owner is driving the computer; nothing was done. Wait and retry, or continue without the computer.",
      ),
    // A hand-back (or close) ends the bot's takeover request; a timeout does not (C28).
    onRelease: (entry) => {
      entry.takeover = undefined;
    },
  });

  const manager: ComputerSessions = {
    width,
    height,
    acquire: (profile) => live.open(profile),
    get: (profile) => live.peek(profile),
    async start(profile) {
      live.forgetOpenError(profile);
      return live.open(profile);
    },
    openState: (profile) => live.openState(profile),
    profiles: () => live.profiles(),
    readTurn: (profile) => live.read(profile, async (entry) => entry, { allowWhileHuman: false }),
    async actionTurn(profile) {
      const entry = await live.act(profile, async (entry) => entry);
      entry.lastActivity = clock.now();
      return entry;
    },
    async setDriver(profile, driver) {
      if (driver === "human") live.takeOver(profile);
      else await live.handBack(profile);
    },
    async requestTakeover(profile, reason, ms) {
      const entry = await live.open(profile);
      // Closed or reset between the open and now: nobody is driving it.
      if (live.peek(profile) !== entry) return "released";
      live.takeOver(profile);
      entry.takeover = { reason, since: clock.now() };
      return (await live.waitForHandBack(entry, ms)) ? "released" : "timeout";
    },
    drop(profile, desktop) {
      const entry = live.peek(profile);
      if (entry?.desktop === desktop) live.drop(profile, entry);
    },
    close: (profile, { wipe = false } = {}) => live.close(profile, { wipe }),
    closeAll: () => live.closeAll(),
  };
  managers.add(manager);
  return manager;
}

/** Graceful shutdown: close every desktop of every manager this process created. */
export async function closeAllComputerSessions(): Promise<void> {
  await Promise.allSettled([...managers].map((manager) => manager.closeAll()));
}
