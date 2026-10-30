/**
 * BrowserPanel (issue #24): the bot's browser, live.
 *
 * On the sandbox VM the browser is a full Chrome on a virtual desktop that
 * the panel streams over VNC (`VncView`): real tabs, address bar and
 * extensions, sharp on Retina, fit to the panel, full-screen capable. Without
 * a VM the browser is headless: the bot can use it, but there is no display
 * to stream, so the panel says so instead of showing a view.
 *
 * The panel is one card: a header (title, connection status, view tools and
 * the hand-off control) over the viewport. Takeover is explicit: the viewer is
 * view-only while the agent drives, and "Take control" flips the server's
 * driver flag, which also pauses the agent's browser tools. "Release control"
 * hands the browser back; the agent continues from the tab the owner left in
 * front.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot as BotIcon,
  ClipboardPaste,
  Globe,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MonitorOff,
  MousePointerClick,
  RotateCcw,
  X,
} from "lucide-react";
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingSpinner,
  Text,
  monoClass,
} from "@groot/ui";
import { cn } from "@groot/shell/lib/utils";
import { toast } from "sonner";
import { useConfirm } from "@groot/ui/primitives";
import { botsApi, type BrowserStatus } from "../lib/bots-api";
import type { Bot } from "../lib/bots-api";
import { VncView, type VncHandle, type VncState } from "./browser/VncView";
import { errorMessage } from "../lib/errors";

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

/** The header is the container: tool labels show once it is wide enough for them. */
const toolLabel = "hidden @xl:inline";
/** Below that width a labelled tool shrinks to a square icon button. */
const toolButton = "@max-xl:w-7 @max-xl:px-0";
/** The hand-off control is the panel's main action, so it keeps its label longer. */
const handoffLabel = "hidden @md:inline";
const handoffButton = "@max-md:w-7 @max-md:px-0";
/**
 * An optional part of the status line. Its separator belongs to it, so a part
 * squeezed out by a narrow header takes the separator along; narrower than
 * that the line is just the connection.
 */
const statusPart = "min-w-0 truncate before:pr-1.5 before:content-['·'] @max-md:hidden";
/** Keeps a state's explanation to a readable line length, even in full screen. */
const noteClass = "mx-auto block max-w-sm";

export function BrowserPanel({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [vncState, setVncState] = useState<VncState>("connecting");
  const [width, setWidth] = useState(readStoredWidth);
  const [fullscreen, setFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const vncRef = useRef<VncHandle>(null);
  const confirm = useConfirm();

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
      toast.error(errorMessage(error, "Failed to switch driver"));
    }
  };

  const openBrowser = async () => {
    try {
      await botsApi.browserStart(bot.id);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to open the browser"));
    }
  };

  // Bots share one browser profile unless set to their own, so a reset can
  // sign every one of them out: say which before wiping.
  const sharedProfile = status?.profile !== "own";
  const resetProfile = async () => {
    const ok = await confirm({
      title: sharedProfile ? "Reset the shared browser?" : "Reset this bot's browser?",
      description: sharedProfile
        ? "This closes the browser that every bot on the shared profile uses and deletes its cookies and logins, so all of those bots are signed out of every site."
        : "This closes the browser and deletes its cookies and logins.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    try {
      await botsApi.browserResetProfile(bot.id);
      setStatus((s) => (s ? { ...s, active: false, url: null, driver: null, mode: null } : s));
      toast.success(
        sharedProfile
          ? "Shared browser wiped; the next session starts fresh."
          : "Browser profile wiped; the next session starts fresh.",
      );
    } catch (error) {
      toast.error(errorMessage(error, "Failed to reset"));
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
    if (starting) return { label: "Starting", dot: "animate-pulse bg-muted-foreground" };
    if (!mode) return { label: "Closed", dot: "bg-muted-foreground" };
    if (mode === "headless") return { label: "Headless", dot: "bg-muted-foreground" };
    if (vncState === "live") return { label: "Live", dot: "bg-success" };
    return {
      label: vncState === "connecting" ? "Connecting" : "Reconnecting",
      dot: "animate-pulse bg-warning",
    };
  })();
  // The streamed Chrome has its own address bar, so the agent's last URL goes
  // while the owner drives.
  const url = mode && !(mode === "vnc" && humanDrives) ? status?.url : null;

  // The panel itself is the full-screen element: its box has to be the whole
  // screen, with nothing around the card, so the viewport (and the remote
  // window fitted to it) fills the display.
  const sizing = fullscreen
    ? "fixed inset-0 z-40 w-full bg-background"
    : "fixed inset-0 z-40 bg-background md:static md:z-auto md:h-full md:w-(--browser-panel-width) md:shrink-0 md:bg-transparent md:p-2 md:pl-0";
  const surface = fullscreen ? "rounded-none ring-0" : "max-md:rounded-none max-md:ring-0";

  return (
    <div
      ref={panelRef}
      className={cn("relative flex flex-col", sizing)}
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

      <Card size="sm" className={cn("min-h-0 flex-1 gap-0 py-0", surface)}>
        <header className="@container flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <CardTitle>Browser</CardTitle>
            <Text variant="meta" className="flex min-w-0 items-center gap-1.5" aria-live="polite">
              <span className={cn("size-1.5 shrink-0 rounded-full", connection.dot)} aria-hidden />
              <span className="shrink-0 font-medium text-foreground">{connection.label}</span>
              {mode && (
                <span className={statusPart} data-testid="browser-driver">
                  {humanDrives ? "You drive" : `${bot.name} drives`}
                </span>
              )}
              {url && (
                <span className={cn(statusPart, "flex-1")} data-testid="browser-url">
                  {url}
                </span>
              )}
            </Text>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {mode === "vnc" &&
              (humanDrives ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className={handoffButton}
                  onClick={() => void setDriver("agent")}
                  aria-label="Release control"
                  title={`Hand the browser back to ${bot.name}`}
                  data-testid="browser-release"
                >
                  <BotIcon />
                  <span className={handoffLabel}>Release control</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  className={handoffButton}
                  onClick={() => void setDriver("human")}
                  aria-label="Take control"
                  title={`Click and type in the browser yourself. ${bot.name} waits.`}
                  data-testid="browser-takeover"
                >
                  <MousePointerClick />
                  <span className={handoffLabel}>Take control</span>
                </Button>
              ))}
            {mode === "vnc" && humanDrives && (
              <Button
                variant="ghost"
                size="sm"
                className={toolButton}
                onClick={pasteClipboard}
                aria-label="Paste from your clipboard"
                title="Paste from your clipboard"
                data-testid="browser-paste"
              >
                <ClipboardPaste />
                <span className={toolLabel}>Paste</span>
              </Button>
            )}
            {mode === "vnc" && (
              <Button
                variant="ghost"
                size="sm"
                className={toolButton}
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                title={fullscreen ? "Exit full screen" : "Full screen"}
                data-testid="browser-fullscreen"
              >
                {fullscreen ? <Minimize2 /> : <Maximize2 />}
                <span className={toolLabel}>{fullscreen ? "Exit full screen" : "Full screen"}</span>
              </Button>
            )}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void resetProfile()}
              aria-label="Reset browser profile"
              title={
                sharedProfile
                  ? "Close the shared browser and wipe its profile (every bot on it)"
                  : "Close the browser and wipe its profile"
              }
              data-testid="browser-reset"
            >
              <RotateCcw className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close browser panel"
              title="Close panel"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="browser-viewport">
          {mode === "vnc" && (
            <VncView ref={vncRef} botId={bot.id} interactive={humanDrives} onState={setVncState} />
          )}
          {mode === "vnc" && vncState !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {vncState === "connecting" ? "Connecting to the browser…" : "Reconnecting…"}
            </div>
          )}

          {mode === "headless" && (
            <div className="h-full" data-testid="browser-headless">
              <EmptyState
                icon={MonitorOff}
                title="No live view for this browser."
                description={
                  <span className={noteClass}>
                    {bot.name} is using a headless browser on this server. Point{" "}
                    <span className={monoClass}>SANDBOX_HOST</span> at a VM to watch it and take
                    control.
                  </span>
                }
                className="h-full py-6"
              />
            </div>
          )}

          {!mode && starting && (
            <EmptyState
              icon={Globe}
              title={
                status?.phase === "installing"
                  ? "Setting up the browser on the VM"
                  : "Starting the browser"
              }
              description={
                <span className={noteClass}>
                  {status?.phase === "installing"
                    ? "First run only: installing Chrome and the display server. This takes a few minutes."
                    : "This takes a few seconds."}
                </span>
              }
              action={<LoadingSpinner size="sm" />}
              className="h-full py-6"
            />
          )}
          {!mode && !starting && status?.error && (
            <ErrorState
              title="Couldn't open the browser"
              description={
                <span className={cn(noteClass, "break-words")} data-testid="browser-error">
                  {status.error}
                </span>
              }
              action={
                <Button size="sm" onClick={() => void openBrowser()} data-testid="browser-open">
                  Try again
                </Button>
              }
              className="h-full py-6"
            />
          )}
          {!mode && !starting && !status?.error && (
            <EmptyState
              icon={Globe}
              title="No browser is open."
              description={`The browser also opens when ${bot.name} first uses it.`}
              action={
                <Button size="sm" onClick={() => void openBrowser()} data-testid="browser-open">
                  Open browser
                </Button>
              }
              className="h-full py-6"
            />
          )}
        </div>
      </Card>
    </div>
  );
}
