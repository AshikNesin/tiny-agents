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

export const POLL_STARTING_MS = 1500;
export const POLL_MS = 3000;

export function pollInterval(starting: boolean): number {
  return starting ? POLL_STARTING_MS : POLL_MS;
}

export const LOCKED_KEYS: Record<LiveViewKind, readonly string[]> = {
  browser: ["Escape", "Tab", "KeyW", "KeyT", "KeyN", "KeyL", "KeyR", "F5"],
  computer: ["Escape", "Tab", "KeyW", "KeyT", "KeyN", "KeyL", "KeyR", "KeyQ", "F4", "F5"],
};

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

function keyboard(): KeyboardLock | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
}

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

export interface ConnectionInput {
  configured?: boolean;
  starting?: boolean;
  mode: "vnc" | "headless" | null;
}

export interface Connection {
  label: "Not set up" | "Starting" | "Closed" | "Headless" | "Live" | "Connecting" | "Reconnecting";
  dot: string;
}

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

export const MIN_PANEL_WIDTH = 360;
const RESERVED_WIDTH = 672;

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
      } catch {}
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  return { width, startResize };
}

interface PipOffset {
  right: number;
  bottom: number;
}

const PIP_KEY = "tiny-agents:live-pip-offset";
const DEFAULT_PIP_OFFSET: PipOffset = { right: 16, bottom: 112 };
const PIP_MARGIN = 8;

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
  } catch {}
  return DEFAULT_PIP_OFFSET;
}

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
      } catch {}
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  return { offset, startDrag };
}

export interface LiveItem {
  active: boolean;
  driver: Driver | null;
  mode?: "vnc" | "headless" | null;
  takeover?: string | null;
  starting?: boolean;
  error?: string | null;
}

export type LiveChange = { driver: Driver } | "started" | "reset";

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

export function isStreaming(kind: LiveViewKind, item: LiveItem | undefined): boolean {
  if (!item?.active) return false;
  return kind === "computer" || item.mode === "vnc";
}

export interface LiveViewSource<S, I extends LiveItem> {
  kind: LiveViewKind;
  source: string;
  load(): Promise<S>;
  select(status: S): I | undefined;
  replace(status: S, item: I): S;
  starting?(status: S): boolean;
  driver(driver: Driver, item: I | undefined): Promise<unknown>;
  start(item: I | undefined): Promise<unknown>;
  reset(item: I | undefined): Promise<unknown>;
  startFailed: string;
  resetCopy(item: I | undefined): { confirm: ConfirmOptions; done: string };
}

export function useLiveView<S, I extends LiveItem>(adapter: LiveViewSource<S, I>) {
  const { kind, source } = adapter;
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
