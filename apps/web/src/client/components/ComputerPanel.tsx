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
import type { ReactNode } from "react";
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
import { cn } from "@groot/ui/lib/utils";
import type { Bot } from "../../shared/api/bots";
import type { ComputerStatus } from "../../shared/api/live";
import { botsApi } from "../lib/bots-api";
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
import { useIsGuest } from "../store/people";
import { VncView } from "./browser/VncView";

const WIDTH_KEY = "tiny-agents:computer-panel-width";
const DEFAULT_WIDTH = 720;

export function ComputerPanel({
  bot,
  onClose,
  tabs,
}: {
  bot: Bot;
  onClose: () => void;
  /** The live view's Browser / Computer switch, in place of the title, when the chat has both. */
  tabs?: ReactNode;
}) {
  const guest = useIsGuest();
  const { width, startResize } = usePanelWidth(WIDTH_KEY, DEFAULT_WIDTH);
  const view = useLiveView<ComputerStatus, ComputerStatus>({
    kind: "computer",
    source: bot.id,
    // The desktop may start on the bot's first computer call, or from "Open
    // computer"; a takeover request flips the driver from the server side.
    load: () => botsApi.computerStatus(bot.id),
    select: (status) => status,
    replace: (_, status) => status,
    driver: (driver) => botsApi.computerDriver(bot.id, driver),
    start: () => botsApi.computerStart(bot.id),
    reset: () => botsApi.computerReset(bot.id),
    startFailed: "Failed to open the computer",
    resetCopy: (status) => {
      const shared = status?.profile !== "own";
      return {
        confirm: {
          title: shared ? "Reset the shared computer?" : "Reset this bot's computer?",
          description: shared
            ? "This closes the desktop every bot on the shared profile uses and deletes its settings and app state. Files in the home folder stay."
            : "This closes the desktop and deletes its settings and app state. Files in the home folder stay.",
          confirmLabel: "Reset",
          destructive: true,
        },
        done: "Computer reset; the next session starts a fresh desktop.",
      };
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
    start: openComputer,
    reset,
    paste: pasteClipboard,
  } = view;

  const starting = Boolean(status?.starting);
  const live = Boolean(status?.active);
  const shared = status?.profile !== "own";

  const connection = connectionOf(
    status && { configured: status.configured, starting, mode: live ? "vnc" : null },
    vncState,
  );

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
            {tabs ?? <CardTitle>Computer</CardTitle>}
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
              !guest &&
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
            {live && humanDrives && !guest && (
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
            {status?.configured && !guest && (
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
              interactive={humanDrives && !guest}
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
                guest ? undefined : (
                  <Button size="sm" onClick={() => void openComputer()} data-testid="computer-open">
                    Try again
                  </Button>
                )
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
                guest ? undefined : (
                  <Button size="sm" onClick={() => void openComputer()} data-testid="computer-open">
                    Open computer
                  </Button>
                )
              }
              className="h-full py-6"
            />
          )}
        </div>
      </Card>
    </div>
  );
}
