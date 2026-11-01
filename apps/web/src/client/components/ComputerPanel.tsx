/**
 * ComputerPanel (issue #108): the bot's computer, live.
 *
 * The computer is an XFCE desktop on the sandbox VM, streamed over VNC with
 * the browser panel's viewer (`VncView`, kind `computer`). The desktop has a
 * fixed size the bot's coordinates depend on, so the viewer scales it to the
 * panel (and to the screen in full screen) and never resizes it.
 *
 * Takeover is the browser's: the viewer is view-only while the bot drives;
 * "Take control" flips the server's driver flag, which pauses the bot's
 * computer tools and stops its screenshots, and "Release control" hands it
 * back. When the bot asked for the takeover itself, the panel says what it
 * asked for.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot as BotIcon,
  ClipboardPaste,
  Hand,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Monitor,
  MonitorOff,
  MousePointerClick,
  RotateCcw,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, CardTitle, EmptyState, ErrorState, LoadingSpinner, Text } from "@groot/ui";
import { cn } from "@groot/shell/lib/utils";
import { toast } from "sonner";
import { useConfirm } from "@groot/ui/primitives";
import { botsApi, type Bot, type ComputerStatus } from "../lib/bots-api";
import { VncView, type VncHandle, type VncState } from "./browser/VncView";
import { errorMessage } from "../lib/errors";

const WIDTH_KEY = "tiny-agents:computer-panel-width";
const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 360;
/** Keys the desktop should get in full screen instead of the page reacting. */
const LOCKED_KEYS = ["Escape", "Tab", "KeyW", "KeyT", "KeyN", "KeyL", "KeyR", "KeyQ", "F4", "F5"];

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

/** Room the docked panel leaves for the sidebar (256px) and a usable chat (416px). */
const RESERVED_WIDTH = 672;

function maxWidth(): number {
  return Math.max(
    MIN_WIDTH,
    Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - RESERVED_WIDTH),
  );
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

const toolLabel = "hidden @xl:inline";
const toolButton = "@max-xl:w-7 @max-xl:px-0";
const handoffLabel = "hidden @md:inline";
const handoffButton = "@max-md:w-7 @max-md:px-0";
const statusPart = "min-w-0 truncate before:pr-1.5 before:content-['·'] @max-md:hidden";
const noteClass = "mx-auto block max-w-sm";

export function ComputerPanel({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [vncState, setVncState] = useState<VncState>("connecting");
  const [width, setWidth] = useState(readStoredWidth);
  const [fullscreen, setFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const vncRef = useRef<VncHandle>(null);
  const confirm = useConfirm();

  const humanDrives = status?.driver === "human";
  const starting = Boolean(status?.starting);
  const live = Boolean(status?.active);

  const refresh = useCallback(async () => {
    try {
      setStatus(await botsApi.computerStatus(bot.id));
    } catch {
      /* the panel stays on the last known status */
    }
  }, [bot.id]);

  // The desktop may start on the bot's first computer call, or from "Open
  // computer"; a takeover request flips the driver from the server side.
  const pollMs = starting ? 1500 : 3000;
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!live) setVncState("connecting");
  }, [live]);

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
      await botsApi.computerDriver(bot.id, driver);
      setStatus((s) =>
        s ? { ...s, driver, ...(driver === "agent" ? { takeover: null } : {}) } : s,
      );
      if (driver === "human") vncRef.current?.focus();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to switch driver"));
    }
  };

  const openComputer = async () => {
    try {
      await botsApi.computerStart(bot.id);
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to open the computer"));
    }
  };

  const shared = status?.profile !== "own";
  const reset = async () => {
    const ok = await confirm({
      title: shared ? "Reset the shared computer?" : "Reset this bot's computer?",
      description: shared
        ? "This closes the desktop every bot on the shared profile uses and deletes its settings and app state. Files in the home folder stay."
        : "This closes the desktop and deletes its settings and app state. Files in the home folder stay.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    try {
      await botsApi.computerReset(bot.id);
      setStatus((s) => (s ? { ...s, active: false, driver: null, takeover: null } : s));
      toast.success("Computer reset; the next session starts a fresh desktop.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to reset"));
    }
  };

  const pasteClipboard = () => {
    void vncRef.current?.paste().catch(() => {
      toast.error("Could not read the clipboard. Allow clipboard access and try again.");
    });
  };

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
    if (status && !status.configured) return { label: "Not set up", dot: "bg-muted-foreground" };
    if (starting) return { label: "Starting", dot: "animate-pulse bg-muted-foreground" };
    if (!live) return { label: "Closed", dot: "bg-muted-foreground" };
    if (vncState === "live") return { label: "Live", dot: "bg-success" };
    return {
      label: vncState === "connecting" ? "Connecting" : "Reconnecting",
      dot: "animate-pulse bg-warning",
    };
  })();

  const sizing = fullscreen
    ? "fixed inset-0 z-40 w-full bg-background"
    : "fixed inset-0 z-40 bg-background xl:static xl:z-auto xl:h-full xl:w-[min(var(--computer-panel-width),calc(100vw-42rem))] xl:shrink-0 xl:bg-transparent xl:p-2 xl:pl-0";
  const surface = fullscreen ? "rounded-none ring-0" : "max-xl:rounded-none max-xl:ring-0";

  return (
    <div
      ref={panelRef}
      className={cn("relative flex flex-col", sizing)}
      style={{ "--computer-panel-width": `${width}px` } as React.CSSProperties}
      data-testid="computer-panel"
    >
      {!fullscreen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize computer panel"
          onPointerDown={startResize}
          className="absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-border xl:block"
        />
      )}

      <Card size="sm" className={cn("min-h-0 flex-1 gap-0 py-0", surface)}>
        <header className="@container flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <CardTitle>Computer</CardTitle>
            <Text variant="meta" className="flex min-w-0 items-center gap-1.5" aria-live="polite">
              <span className={cn("size-1.5 shrink-0 rounded-full", connection.dot)} aria-hidden />
              <span className="shrink-0 font-medium text-foreground">{connection.label}</span>
              {live && (
                <span className={statusPart} data-testid="computer-driver">
                  {humanDrives ? "You drive" : `${bot.name} drives`}
                </span>
              )}
              {live && status?.width && status.height && (
                <span className={statusPart}>
                  {status.width}×{status.height}
                </span>
              )}
            </Text>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {live &&
              (humanDrives ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className={handoffButton}
                  onClick={() => void setDriver("agent")}
                  aria-label="Release control"
                  title={`Hand the computer back to ${bot.name}`}
                  data-testid="computer-release"
                >
                  <BotIcon />
                  <span className={handoffLabel}>
                    {status?.takeover ? "I'm done" : "Release control"}
                  </span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  className={handoffButton}
                  onClick={() => void setDriver("human")}
                  aria-label="Take control"
                  title={`Click and type on the computer yourself. ${bot.name} waits and sees nothing.`}
                  data-testid="computer-takeover"
                >
                  <MousePointerClick />
                  <span className={handoffLabel}>Take control</span>
                </Button>
              ))}
            {live && humanDrives && (
              <Button
                variant="ghost"
                size="sm"
                className={toolButton}
                onClick={pasteClipboard}
                aria-label="Paste from your clipboard"
                title="Paste from your clipboard"
                data-testid="computer-paste"
              >
                <ClipboardPaste />
                <span className={toolLabel}>Paste</span>
              </Button>
            )}
            {live && (
              <Button
                variant="ghost"
                size="sm"
                className={toolButton}
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                title={fullscreen ? "Exit full screen" : "Full screen"}
                data-testid="computer-fullscreen"
              >
                {fullscreen ? <Minimize2 /> : <Maximize2 />}
                <span className={toolLabel}>{fullscreen ? "Exit full screen" : "Full screen"}</span>
              </Button>
            )}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
            {status?.configured && (
              <Button variant="ghost" size="icon-sm" asChild>
                <Link
                  to="/computer"
                  aria-label="Open the Computer page"
                  title="Open the Computer page"
                  data-testid="computer-open-page"
                >
                  <SquareArrowOutUpRight className="size-3.5" />
                </Link>
              </Button>
            )}
            {status?.configured && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void reset()}
                aria-label="Reset computer"
                title={
                  shared
                    ? "Close the shared desktop and wipe its settings (every bot on it)"
                    : "Close the desktop and wipe its settings"
                }
                data-testid="computer-reset"
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close computer panel"
              title="Close panel"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </header>

        {live && humanDrives && status?.takeover && (
          <div
            className="flex shrink-0 items-start gap-2 border-b bg-primary/5 px-4 py-2 text-sm"
            data-testid="computer-takeover-reason"
          >
            <Hand className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="font-medium">{bot.name} asked you:</span> {status.takeover}{" "}
              <span className="text-muted-foreground">
                It sees nothing until you press I'm done.
              </span>
            </span>
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="computer-viewport">
          {live && (
            <VncView
              ref={vncRef}
              botId={bot.id}
              kind="computer"
              interactive={humanDrives}
              onState={setVncState}
            />
          )}
          {live && vncState !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {vncState === "connecting" ? "Connecting to the computer…" : "Reconnecting…"}
            </div>
          )}

          {status && !status.configured && (
            <EmptyState
              icon={MonitorOff}
              title="No computer on this server."
              description={
                <span className={noteClass} data-testid="computer-setup-hint">
                  {status.setupHint ?? "The computer is not configured."}
                </span>
              }
              className="h-full py-6"
            />
          )}
          {status?.configured && !live && starting && (
            <EmptyState
              icon={Monitor}
              title={
                status.phase === "installing"
                  ? "Setting up the computer on the VM"
                  : "Starting the computer"
              }
              description={
                <span className={noteClass}>
                  {status.phase === "installing"
                    ? "First run only: installing the desktop and its tools. This takes a few minutes."
                    : "This takes a few seconds."}
                </span>
              }
              action={<LoadingSpinner size="sm" />}
              className="h-full py-6"
            />
          )}
          {status?.configured && !live && !starting && status.error && (
            <ErrorState
              title="Couldn't open the computer"
              description={
                <span className={cn(noteClass, "break-words")} data-testid="computer-error">
                  {status.error}
                </span>
              }
              action={
                <Button size="sm" onClick={() => void openComputer()} data-testid="computer-open">
                  Try again
                </Button>
              }
              className="h-full py-6"
            />
          )}
          {status?.configured && !live && !starting && !status.error && (
            <EmptyState
              icon={Monitor}
              title="The computer is off."
              description={`It also starts when ${bot.name} first uses it.`}
              action={
                <Button size="sm" onClick={() => void openComputer()} data-testid="computer-open">
                  Open computer
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
