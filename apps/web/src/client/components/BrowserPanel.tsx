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
  SquareArrowOutUpRight,
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
import { Link } from "react-router-dom";
import { useIsGuest } from "../store/people";
import { botsApi, type BrowserStatus } from "../lib/bots-api";
import type { Bot } from "../lib/bots-api";
import {
  connectionOf,
  panelHandoffButton as handoffButton,
  panelHandoffLabel as handoffLabel,
  panelNote as noteClass,
  panelStatusPart as statusPart,
  panelToolButton as toolButton,
  panelToolLabel as toolLabel,
  useLiveView,
  usePanelWidth,
} from "../lib/live-view";
import { VncView } from "./browser/VncView";

const WIDTH_KEY = "tiny-agents:browser-panel-width";
const DEFAULT_WIDTH = 640;

export function BrowserPanel({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const guest = useIsGuest();
  // Desktop only: drag the left edge to size the panel.
  const { width, startResize } = usePanelWidth(WIDTH_KEY, DEFAULT_WIDTH);
  const view = useLiveView<BrowserStatus, BrowserStatus>({
    kind: "browser",
    source: bot.id,
    // The session may start on the bot's first browser tool call, or from
    // "Open browser"; the poll follows either.
    load: () => botsApi.browserStatus(bot.id),
    select: (status) => status,
    replace: (_, status) => status,
    driver: (driver) => botsApi.browserDriver(bot.id, driver),
    start: () => botsApi.browserStart(bot.id),
    reset: () => botsApi.browserResetProfile(bot.id),
    startFailed: "Failed to open the browser",
    // Bots share one browser profile unless set to their own, so a reset can
    // sign every one of them out: say which before wiping.
    resetCopy: (status) =>
      status?.profile !== "own"
        ? {
            confirm: {
              title: "Reset the shared browser?",
              description:
                "This closes the browser that every bot on the shared profile uses and deletes its cookies and logins, so all of those bots are signed out of every site.",
              confirmLabel: "Reset",
              destructive: true,
            },
            done: "Shared browser wiped; the next session starts fresh.",
          }
        : {
            confirm: {
              title: "Reset this bot's browser?",
              description: "This closes the browser and deletes its cookies and logins.",
              confirmLabel: "Reset",
              destructive: true,
            },
            done: "Browser profile wiped; the next session starts fresh.",
          },
  });
  const {
    status,
    humanDrives,
    vncRef,
    vncState,
    setVncState,
    regionRef: panelRef,
    fullscreen,
    toggleFullscreen,
    setDriver,
    start: openBrowser,
    reset: resetProfile,
    paste: pasteClipboard,
  } = view;

  const starting = Boolean(status?.starting);
  const mode = status?.active ? (status.mode ?? "headless") : null;
  const sharedProfile = status?.profile !== "own";
  // The Browser page (issue #160) is the owner's; it opens on this browser.
  const pageLink = `/browser?profile=${encodeURIComponent(sharedProfile ? "shared" : `bot-${bot.id}`)}`;

  const connection = connectionOf(status && { starting, mode }, vncState);
  // The streamed Chrome has its own address bar, so the agent's last URL goes
  // while the owner drives.
  const url = mode && !(mode === "vnc" && humanDrives) ? status?.url : null;

  // The panel itself is the full-screen element: its box has to be the whole
  // screen, with nothing around the card, so the viewport (and the remote
  // window fitted to it) fills the display.
  const sizing = fullscreen
    ? "fixed inset-0 z-40 w-full bg-background"
    : // Docked beside the chat only where both fit (xl, and never wider than
      // the viewport leaves after the sidebar and a 26rem chat); narrower
      // screens get the panel over the chat, closable, like phones (#89).
      "fixed inset-0 z-40 bg-background xl:static xl:z-auto xl:h-full xl:w-[min(var(--browser-panel-width),calc(100vw-42rem))] xl:shrink-0 xl:bg-transparent xl:p-2 xl:pl-0";
  const surface = fullscreen ? "rounded-none ring-0" : "max-xl:rounded-none max-xl:ring-0";

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
          className="absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-border xl:block"
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
            {!guest && (
              <Button variant="ghost" size="icon-sm" asChild>
                <Link
                  to={pageLink}
                  aria-label="Open in the Browser page"
                  title="Open in the Browser page"
                  data-testid="browser-open-page"
                >
                  <SquareArrowOutUpRight className="size-3.5" />
                </Link>
              </Button>
            )}
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
