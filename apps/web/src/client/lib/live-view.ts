/**
 * The Live view (GLOSSARY): the owner's noVNC view of a bot's browser or
 * desktop. The chat's panel (`components/live/LivePanel.tsx`) and the page
 * (`components/live/LivePage.tsx`) show one for either surface, and this
 * module owns what they share, so a surface (`components/live/surfaces.tsx`)
 * keeps only its source and its copy:
 *
 * - the status poll and its cadence (`pollInterval`: every 1.5s while
 *   anything it shows is starting, else every 3s);
 * - the driver switch (take control / release) and the optimistic status a
 *   server action leaves behind until the next poll confirms it (`settle`);
 * - opening and resetting the browser or desktop;
 * - full screen with the keyboard lock, keyed by kind (`LOCKED_KEYS`);
 * - the connection label and dot (`connectionOf`);
 * - the docked panel's persisted, clamped width (`usePanelWidth`);
 * - the picture in picture's persisted, dragged corner (`usePipPosition`).
 *
 * `useFullScreen` also serves the Terminal page, with its CSS fallback. When
 * the bot is using a view, and docked versus picture in picture, are in
 * `browser-panel.ts`.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { useConfirm, type ConfirmOptions } from "@groot/ui/primitives";
import type { VncHandle, VncState } from "../components/browser/VncView";
import { errorMessage } from "./errors";

export type LiveViewKind = "browser" | "computer";
export type Driver = "agent" | "human";

// ---------------------------------------------------------------------------
// Poll cadence

/** While a browser or desktop starts, the poll follows it closely. */
export const POLL_STARTING_MS = 1500;
/** Otherwise the poll catches sessions opened, closed or handed over elsewhere. */
export const POLL_MS = 3000;

export function pollInterval(starting: boolean): number {
  return starting ? POLL_STARTING_MS : POLL_MS;
}

// ---------------------------------------------------------------------------
// Keyboard lock

/**
 * Keys the remote side gets in full screen instead of the local browser
 * reacting (closing the tab, reloading, leaving full screen on Escape).
 * The desktop also takes Ctrl+Q and Alt+F4 for its own apps, and Ctrl+L and
 * Ctrl+R for their location bars and reloads.
 */
export const LOCKED_KEYS: Record<LiveViewKind, readonly string[]> = {
  browser: ["Escape", "Tab", "KeyW", "KeyT", "KeyN", "KeyL", "KeyR", "F5"],
  computer: ["Escape", "Tab", "KeyW", "KeyT", "KeyN", "KeyL", "KeyR", "KeyQ", "F4", "F5"],
};

/** The Keyboard Lock API, which only Chromium ships. */
type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

function keyboard(): KeyboardLock | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
}

/**
 * Full screen on one element, with `keys` locked while it lasts. By default
 * the Fullscreen API is the state and a refusal is a toast. `fallback: "css"`
 * makes the state the caller's CSS instead (the Terminal's `fixed inset-0`),
 * so it also works where the API does not (iOS Safari never fullscreens a
 * div); the API is then best-effort chrome-hiding whose events stay in sync.
 */
export function useFullScreen(
  ref: RefObject<HTMLElement | null>,
  keys: readonly string[],
  options: { fallback?: "css" } = {},
): { fullscreen: boolean; toggleFullscreen: () => void } {
  const [fullscreen, setFullscreen] = useState(false);
  const css = options.fallback === "css";

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [ref]);

  useEffect(() => {
    if (!fullscreen) return;
    const lock = keyboard();
    void lock?.lock?.([...keys]).catch(() => undefined);
    return () => lock?.unlock?.();
  }, [fullscreen, keys]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
      return;
    }
    if (css) {
      // Already pseudo-full-screen (the API was missing or refused): leave it.
      if (fullscreen) {
        setFullscreen(false);
        return;
      }
      setFullscreen(true);
      ref.current?.requestFullscreen?.().catch(() => undefined);
      return;
    }
    const element = ref.current;
    if (!element?.requestFullscreen) {
      toast.error("Full screen is not available in this browser.");
      return;
    }
    void element.requestFullscreen().catch(() => toast.error("Could not enter full screen."));
  };

  return { fullscreen, toggleFullscreen };
}

// ---------------------------------------------------------------------------
// Connection label

export interface ConnectionInput {
  /** False when the server has no live view of this kind to offer at all. */
  configured?: boolean;
  starting?: boolean;
  /** `vnc` streams; `headless` runs without a display; null while closed. */
  mode: "vnc" | "headless" | null;
}

export interface Connection {
  label: "Not set up" | "Starting" | "Closed" | "Headless" | "Live" | "Connecting" | "Reconnecting";
  /** Token classes for the status dot. */
  dot: string;
}

/** What the status line says about a live view, and the colour of its dot. */
export function connectionOf(status: ConnectionInput | null, vncState: VncState): Connection {
  const idle = "bg-muted-foreground";
  if (status?.configured === false) return { label: "Not set up", dot: idle };
  if (status?.starting) return { label: "Starting", dot: `animate-pulse ${idle}` };
  if (!status?.mode) return { label: "Closed", dot: idle };
  if (status.mode === "headless") return { label: "Headless", dot: idle };
  if (vncState === "live") return { label: "Live", dot: "bg-success" };
  return {
    label: vncState === "connecting" ? "Connecting" : "Reconnecting",
    dot: "animate-pulse bg-warning",
  };
}

// ---------------------------------------------------------------------------
// Docked panel width

export const MIN_PANEL_WIDTH = 360;
/** Room the docked panel leaves for the sidebar (256px) and a usable chat (416px). */
const RESERVED_WIDTH = 672;

/** The widest a docked panel gets in a viewport `viewport` pixels wide. */
export function maxPanelWidth(viewport: number): number {
  return Math.max(
    MIN_PANEL_WIDTH,
    Math.min(Math.floor(viewport * 0.75), viewport - RESERVED_WIDTH),
  );
}

export function clampPanelWidth(value: number, viewport: number): number {
  return Math.min(maxPanelWidth(viewport), Math.max(MIN_PANEL_WIDTH, Math.round(value)));
}

function readPanelWidth(key: string, fallback: number): number {
  const viewport = window.innerWidth;
  try {
    const stored = Number(window.localStorage.getItem(key));
    return clampPanelWidth(stored > 0 ? stored : fallback, viewport);
  } catch {
    return clampPanelWidth(fallback, viewport);
  }
}

/**
 * A docked panel's width, dragged on its left edge and remembered under
 * `storageKey`. The remote side refits itself to whatever the panel becomes.
 */
export function usePanelWidth(storageKey: string, defaultWidth: number) {
  const [width, setWidth] = useState(() => readPanelWidth(storageKey, defaultWidth));

  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let latest = width;
    const move = (e: PointerEvent) => {
      latest = clampPanelWidth(startWidth + (startX - e.clientX), window.innerWidth);
      setWidth(latest);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      try {
        window.localStorage.setItem(storageKey, String(latest));
      } catch {
        /* storage unavailable: the size just won't persist */
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  return { width, startResize };
}

// ---------------------------------------------------------------------------
// Picture in picture

/** Where the floating view sits: its gap to the viewport's right and bottom edges. */
interface PipOffset {
  right: number;
  bottom: number;
}

const PIP_KEY = "tiny-agents:live-pip-offset";
/** Clear of the composer, so the newest message and the input stay in reach. */
const DEFAULT_PIP_OFFSET: PipOffset = { right: 16, bottom: 112 };
/** The edge it keeps from the viewport. */
const PIP_MARGIN = 8;

/** Keeps a `width` x `height` view whole inside a `viewport` of the given size. */
function clampPipOffset(
  offset: PipOffset,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): PipOffset {
  const clamp = (value: number, room: number) =>
    Math.round(Math.min(Math.max(value, PIP_MARGIN), Math.max(PIP_MARGIN, room - PIP_MARGIN)));
  return {
    right: clamp(offset.right, viewport.width - size.width),
    bottom: clamp(offset.bottom, viewport.height - size.height),
  };
}

function readPipOffset(): PipOffset {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PIP_KEY) ?? "null");
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as PipOffset).right === "number" &&
      typeof (parsed as PipOffset).bottom === "number"
    )
      return { right: (parsed as PipOffset).right, bottom: (parsed as PipOffset).bottom };
  } catch {
    /* unreadable: the default corner */
  }
  return DEFAULT_PIP_OFFSET;
}

/**
 * The picture in picture's corner, dragged by its header (mouse or touch)
 * and remembered. A press on one of the header's buttons is a click, not a
 * drag. `ref` is the floating box, measured to keep it on screen.
 */
export function usePipPosition(ref: RefObject<HTMLElement | null>) {
  const [offset, setOffset] = useState<PipOffset>(readPipOffset);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button, a")) return;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const start = {
      right: window.innerWidth - box.right,
      bottom: window.innerHeight - box.bottom,
    };
    let latest = start;
    const move = (e: PointerEvent) => {
      latest = clampPipOffset(
        { right: start.right - (e.clientX - startX), bottom: start.bottom - (e.clientY - startY) },
        box,
        { width: window.innerWidth, height: window.innerHeight },
      );
      setOffset(latest);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      try {
        window.localStorage.setItem(PIP_KEY, JSON.stringify(latest));
      } catch {
        /* storage unavailable: the corner just won't persist */
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  return { offset, startDrag };
}

// ---------------------------------------------------------------------------
// The live view's state

/** What every browser or desktop status has, whichever API it came from. */
export interface LiveItem {
  active: boolean;
  driver: Driver | null;
  /** Browsers only: whether the live browser streams. */
  mode?: "vnc" | "headless" | null;
  /** Desktops only: what a bot asked the owner to do while it waits. */
  takeover?: string | null;
  starting?: boolean;
  error?: string | null;
}

export type LiveChange = { driver: Driver } | "started" | "reset";

/**
 * The status after the server accepted `change`, until the next poll says
 * otherwise: a release answers a desktop's takeover request, an open starts,
 * and a reset closes the browser or desktop.
 */
export function settle<I extends LiveItem>(kind: LiveViewKind, item: I, change: LiveChange): I {
  if (change === "started") return { ...item, starting: true, error: null };
  if (change === "reset") {
    return kind === "browser"
      ? { ...item, active: false, driver: null, mode: null }
      : { ...item, active: false, driver: null, takeover: null };
  }
  const answered = kind === "computer" && change.driver === "agent" ? { takeover: null } : {};
  return { ...item, driver: change.driver, ...answered };
}

/** A live view streams while its browser or desktop is open with a display. */
export function isStreaming(kind: LiveViewKind, item: LiveItem | undefined): boolean {
  if (!item?.active) return false;
  return kind === "computer" || item.mode === "vnc";
}

/**
 * Where a surface's live view comes from. A panel loads one bot's status
 * (`S` is the item); a page loads every browser or desktop and shows the one
 * selected (`select`/`replace` pick it out of the list).
 */
export interface LiveViewSource<S, I extends LiveItem> {
  kind: LiveViewKind;
  /** What `load` reads (a bot id, or the page's list): a change reloads at once. */
  source: string;
  load(): Promise<S>;
  select(status: S): I | undefined;
  replace(status: S, item: I): S;
  /** Whether the poll should follow something starting; defaults to the selected item. */
  starting?(status: S): boolean;
  /** The actions act on the item selected when the owner asked (undefined before the first load). */
  driver(driver: Driver, item: I | undefined): Promise<unknown>;
  start(item: I | undefined): Promise<unknown>;
  reset(item: I | undefined): Promise<unknown>;
  /** The toast when opening fails ("Failed to open the browser"). */
  startFailed: string;
  /** The reset's confirm dialog and its toast once done, for the selected item. */
  resetCopy(item: I | undefined): { confirm: ConfirmOptions; done: string };
}

/**
 * One surface's live view: the polled status, the viewer's connection, full
 * screen on `regionRef`, and the owner's actions. Load failures are kept in
 * `error` (cleared by the next good load); the view stays on the last status.
 */
export function useLiveView<S, I extends LiveItem>(adapter: LiveViewSource<S, I>) {
  const { kind, source } = adapter;
  // The adapter is rebuilt every render; actions and the poll read the latest.
  const adapterRef = useRef(adapter);
  useEffect(() => {
    adapterRef.current = adapter;
  });

  const [status, setStatus] = useState<S | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [vncState, setVncState] = useState<VncState>("connecting");
  const regionRef = useRef<HTMLDivElement>(null);
  const vncRef = useRef<VncHandle>(null);
  const confirm = useConfirm();
  const { fullscreen, toggleFullscreen } = useFullScreen(regionRef, LOCKED_KEYS[kind]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await adapterRef.current.load());
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  const item = status ? adapter.select(status) : undefined;
  const starting = status ? (adapter.starting?.(status) ?? Boolean(item?.starting)) : false;
  const pollMs = pollInterval(starting);
  // A new source (another bot) loads at once and restarts the poll.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs, source]);

  const streaming = isStreaming(kind, item);
  useEffect(() => {
    if (!streaming) setVncState("connecting");
  }, [streaming]);

  const apply = (change: LiveChange) =>
    setStatus((current) => {
      if (!current) return current;
      const { select, replace } = adapterRef.current;
      const selected = select(current);
      return selected ? replace(current, settle(kind, selected, change)) : current;
    });

  const setDriver = async (driver: Driver) => {
    try {
      await adapterRef.current.driver(driver, item);
      apply({ driver });
      if (driver === "human") vncRef.current?.focus();
      // Releasing makes the bot carry on from where the owner left it.
      else await refresh();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to switch driver"));
    }
  };

  const start = async () => {
    const source = adapterRef.current;
    try {
      await source.start(item);
      apply("started");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, source.startFailed));
    }
  };

  const reset = async () => {
    const source = adapterRef.current;
    const copy = source.resetCopy(item);
    if (!(await confirm(copy.confirm))) return;
    try {
      await source.reset(item);
      apply("reset");
      toast.success(copy.done);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to reset"));
    }
  };

  const paste = () => {
    void vncRef.current?.paste().catch(() => {
      toast.error("Could not read the clipboard. Allow clipboard access and try again.");
    });
  };

  return {
    status,
    item,
    error,
    refresh,
    streaming,
    humanDrives: item?.driver === "human",
    vncRef,
    vncState,
    setVncState,
    regionRef,
    fullscreen,
    toggleFullscreen,
    setDriver,
    start,
    reset,
    paste,
  };
}
