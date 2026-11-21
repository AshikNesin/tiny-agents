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

type ComputerPhase = LivePhase;

type ComputerDriver = LiveDriver;

export type MouseButton = "left" | "right" | "middle";
export type ScrollDirection = "up" | "down" | "left" | "right";
export type KeyModifier = "ctrl" | "shift" | "alt" | "super";

export interface ComputerWindow {
  id: string;
  windowClass: string;
  title: string;
  active: boolean;
}

export interface ComputerApp {
  id: string;
  name: string;
}

export interface WindowBinding {
  windowClass: string;
  title?: string;
}

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

export class DesktopGoneError extends Error {
  constructor(message = "The computer's desktop stopped running.") {
    super(message);
    this.name = "DesktopGoneError";
  }
}

export class OwnerDrivingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerDrivingError";
  }
}

export interface ComputerDesktop {
  readonly width: number;
  readonly height: number;
  vnc?: { openStream(): Promise<Duplex> };
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
  type(text: string): Promise<void>;
  key(chords: string[], repeat: number): Promise<void>;
  listWindows(): Promise<ComputerWindow[]>;
  focusWindow(id: string): Promise<void>;
  closeWindow(id: string): Promise<void>;
  listApps(): Promise<ComputerApp[]>;
  openApp(id: string): Promise<void>;
  clipboardGet(): Promise<string>;
  clipboardSet(text: string): Promise<void>;
  typeSecret(text: string, binding: WindowBinding): Promise<void>;
  onDisconnect?(listener: () => void): void;
  close(): Promise<void>;
}

interface OpenDesktopOptions {
  width: number;
  height: number;
  onPhase?: (phase: ComputerPhase) => void;
}

export interface ComputerTransport {
  open(profile: string, options: OpenDesktopOptions): Promise<ComputerDesktop>;
  wipe(profile: string): Promise<void>;
}

export interface LiveComputer {
  desktop: ComputerDesktop;
  driver: ComputerDriver;
  lastActivity: number;
  idleMs: number;
  takeover?: { reason: string; since: number };
}

type ComputerOpenState = LiveOpenState;

export interface ComputerSessionsOptions {
  transport: ComputerTransport;
  width?: number;
  height?: number;
  idleMinutes?: number;
  humanDriverWaitMs?: number;
  clock?: BrowserClock;
}

export interface ComputerSessions {
  readonly width: number;
  readonly height: number;
  acquire(profile: string): Promise<LiveComputer>;
  get(profile: string): LiveComputer | undefined;
  start(profile: string): Promise<LiveComputer>;
  openState(profile: string): ComputerOpenState;
  profiles(): string[];
  readTurn(profile: string): Promise<LiveComputer>;
  actionTurn(profile: string): Promise<LiveComputer>;
  setDriver(profile: string, driver: ComputerDriver): Promise<void>;
  ownerInput(profile: string): void;
  requestTakeover(profile: string, reason: string, ms: number): Promise<"released" | "timeout">;
  drop(profile: string, desktop: ComputerDesktop): void;
  close(profile: string, options?: { wipe?: boolean }): Promise<void>;
  closeAll(): Promise<void>;
}

const OWNER_DRIVING =
  "The owner is driving the computer, so screenshots are paused. Wait for them to hand it back, or continue without the computer.";

export interface ChatTakeover {
  status: "pending" | "released" | "expired";
  reason: string;
}

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
    sweepReleases: true,
    wipeCancelledOpen: true,
    closeErrors: "swallow",
    closedWhileOpening: "The computer was closed while it was starting.",
    describeOpenError: (error) => (error instanceof Error ? error.message : String(error)),
    ownerDriving: (kind) =>
      new OwnerDrivingError(
        kind === "read"
          ? OWNER_DRIVING
          : "The owner is driving the computer; nothing was done. Wait and retry, or continue without the computer.",
      ),
    onRelease: (entry) => {
      entry.takeover = undefined;
    },
    handBackIdle: (profile) => void live.handBack(profile),
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
    readTurn: (profile) => live.read(profile, { allowWhileHuman: false }),
    actionTurn: (profile) =>
      live.act(profile, {
        finish: (entry) => {
          entry.lastActivity = clock.now();
        },
      }),
    async setDriver(profile, driver) {
      if (driver === "human") {
        live.takeOver(profile);
        live.ownerInput(profile);
      } else live.handBack(profile);
    },
    ownerInput: (profile) => live.ownerInput(profile),
    async requestTakeover(profile, reason, ms) {
      const entry = await live.open(profile);
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

export async function closeAllComputerSessions(): Promise<void> {
  await Promise.allSettled([...managers].map((manager) => manager.closeAll()));
}
