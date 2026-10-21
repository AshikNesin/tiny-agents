/**
 * BrowserPanel (issue #24): the bot's browser, live.
 *
 * On the sandbox VM the browser is a full Chrome on a virtual desktop that
 * the panel streams over VNC (`VncView`): real tabs, address bar and
 * extensions, sharp on Retina, fit to the panel, full-screen capable. Without
 * a VM the browser is headless: the bot can use it, but there is no display
 * to stream, so the panel says so instead of showing a view.
 *
 * Takeover is explicit: the viewer is view-only while the agent drives, and
 * "Take control" flips the server's driver flag, which also pauses the
 * agent's browser tools. "Release" hands the browser back; the agent
 * continues from the tab the owner left in front.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClipboardPaste,
  Globe,
  LoaderCircle,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
} from "lucide-react";
import { Button, StatusBadge } from "@groot/ui";
import { toast } from "sonner";
import { botsApi, type BrowserStatus } from "../lib/bots-api";
import type { Bot } from "../lib/bots-api";
import { VncView, type VncHandle, type VncState } from "./browser/VncView";

const WIDTH_KEY = "tiny-agents:browser-panel-width";
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 360;
/** Keys the page should see in full screen instead of the browser reacting. */
const LOCKED_KEYS = ["Escape", "Tab", "KeyW", "KeyT", "KeyN", "KeyL", "KeyR", "F5"];

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

function maxWidth(): number {
  return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.75));
}

function clampWidth(value: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY));
    return stored > 0 ? clampWidth(stored) : clampWidth(DEFAULT_WIDTH);
  } catch {
    return clampWidth(DEFAULT_WIDTH);
  }
}

export function BrowserPanel({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [vncState, setVncState] = useState<VncState>("connecting");
  const [width, setWidth] = useState(readStoredWidth);
  const [fullscreen, setFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const vncRef = useRef<VncHandle>(null);

  const humanDrives = status?.driver === "human";
  const starting = Boolean(status?.starting);
  const mode = status?.active ? (status.mode ?? "headless") : null;

  const refresh = useCallback(async () => {
    try {
      setStatus(await botsApi.browserStatus(bot.id));
    } catch {
      /* the panel stays on the last known status */
    }
  }, [bot.id]);

  // Poll status: the session may start on the bot's first browser tool call,
  // or from "Open browser" (faster while it opens).
  const pollMs = starting ? 1500 : 4000;
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!status?.active) setVncState("connecting");
  }, [status?.active]);

  useEffect(() => {
    const onChange = () => {
      const full = document.fullscreenElement === panelRef.current;
      setFullscreen(full);
      const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
      if (full) void keyboard?.lock?.(LOCKED_KEYS).catch(() => undefined);
      else keyboard?.unlock?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    const panel = panelRef.current;
    if (!panel?.requestFullscreen) {
      toast.error("Full screen is not available in this browser.");
      return;
    }
    void panel.requestFullscreen().catch(() => toast.error("Could not enter full screen."));
  };

  const setDriver = async (driver: "agent" | "human") => {
    try {
      await botsApi.browserDriver(bot.id, driver);
      setStatus((s) => (s ? { ...s, driver } : s));
      // Releasing makes the agent adopt the tab the owner left in front.
      if (driver === "agent") await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to switch driver");
    }
  };

  const openBrowser = async () => {
    try {
      await botsApi.browserStart(bot.id);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open the browser");
    }
  };

  const resetProfile = async () => {
    try {
      await botsApi.browserResetProfile(bot.id);
      setStatus((s) => (s ? { ...s, active: false, url: null, driver: null, mode: null } : s));
      toast.success("Browser profile wiped; the next session starts fresh.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset");
    }
  };

  const pasteClipboard = () => {
    void vncRef.current?.paste().catch(() => {
      toast.error("Could not read the clipboard. Allow clipboard access and try again.");
    });
  };

  // Desktop only: drag the left edge to size the panel. The remote browser
  // refits itself to whatever the panel becomes.
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let latest = width;
    const move = (e: PointerEvent) => {
      latest = clampWidth(startWidth + (startX - e.clientX));
      setWidth(latest);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      try {
        window.localStorage.setItem(WIDTH_KEY, String(latest));
      } catch {
        /* storage unavailable: the size just won't persist */
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  const connection = (() => {
    if (starting) return { status: "pending", label: "Starting" };
    if (!mode) return { status: "cancelled", label: "Closed" };
    if (mode === "headless") return { status: "cancelled", label: "Headless" };
    if (vncState === "live") return { status: "success", label: "Live" };
    return {
      status: "warning",
      label: vncState === "connecting" ? "Connecting" : "Reconnecting",
    };
  })();

  const sizing = fullscreen
    ? "fixed inset-0 z-40 w-full"
    : "fixed inset-0 z-40 md:static md:z-auto md:h-full md:w-(--browser-panel-width) md:shrink-0 md:border-l";

  return (
    <div
      ref={panelRef}
      className={`bg-background relative flex flex-col ${sizing}`}
      style={{ "--browser-panel-width": `${width}px` } as React.CSSProperties}
      data-testid="browser-panel"
    >
      {!fullscreen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize browser panel"
          onPointerDown={startResize}
          className="absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-border md:block"
          data-testid="browser-resize"
        />
      )}

      <div className="flex items-center gap-2 border-b px-3 py-2">
        <StatusBadge status={connection.status} label={connection.label} />
        <span className="truncate text-xs text-muted-foreground" data-testid="browser-url">
          {mode === "vnc" && humanDrives ? "" : (status?.url ?? "")}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {mode === "vnc" && humanDrives && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={pasteClipboard}
              aria-label="Paste from your clipboard"
              title="Paste from your clipboard"
              data-testid="browser-paste"
            >
              <ClipboardPaste className="size-3.5" />
            </Button>
          )}
          {mode === "vnc" && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
              title={fullscreen ? "Exit full screen" : "Full screen"}
              data-testid="browser-fullscreen"
            >
              {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void resetProfile()}
            aria-label="Reset browser profile"
            title="Close the browser and wipe its profile"
            data-testid="browser-reset"
          >
            <RotateCcw className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close browser panel">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden" data-testid="browser-viewport">
        {mode === "vnc" && (
          <VncView ref={vncRef} botId={bot.id} interactive={humanDrives} onState={setVncState} />
        )}
        {mode === "headless" && (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
            data-testid="browser-headless"
          >
            <Globe className="size-4 text-muted-foreground" />
            <p className="text-sm">No live view for this browser.</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {bot.name} is using a headless browser on this server. Point SANDBOX_HOST at a VM to
              watch it and take control.
            </p>
          </div>
        )}

        {mode === "vnc" && vncState !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            {vncState === "connecting" ? "Connecting to the browser…" : "Reconnecting…"}
          </div>
        )}

        {!mode && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            {starting ? (
              <>
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                <p className="text-sm">
                  {status?.phase === "installing"
                    ? "Setting up the browser on the VM"
                    : "Starting the browser"}
                </p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {status?.phase === "installing"
                    ? "First run only: installing Chrome and the display server. This takes a few minutes."
                    : "This takes a few seconds."}
                </p>
              </>
            ) : (
              <>
                <Globe className="size-4 text-muted-foreground" />
                {status?.error ? (
                  <p className="max-w-sm text-xs text-destructive" data-testid="browser-error">
                    {status.error}
                  </p>
                ) : (
                  <p className="text-sm">No browser is open.</p>
                )}
                <Button size="sm" onClick={() => void openBrowser()} data-testid="browser-open">
                  {status?.error ? "Try again" : "Open browser"}
                </Button>
                <p className="max-w-xs text-xs text-muted-foreground">
                  The browser also opens when {bot.name} first uses it.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2">
        {humanDrives ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void setDriver("agent")}
            data-testid="browser-release"
          >
            Release to {bot.name}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void setDriver("human")}
            disabled={mode !== "vnc"}
            data-testid="browser-takeover"
          >
            Take control
          </Button>
        )}
        <span className="truncate text-xs text-muted-foreground" data-testid="browser-driver">
          {humanDrives ? "You drive" : `${bot.name} drives`}
        </span>
      </div>
    </div>
  );
}
