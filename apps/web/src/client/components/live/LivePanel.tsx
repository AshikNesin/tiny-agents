/**
 * The chat's live-view panel: one bot's browser (issue #24) or desktop
 * (issue #108), live, for the surface it is given (`surface.ts`).
 *
 * On the sandbox VM the browser is a full Chrome, and the computer an XFCE
 * desktop, on a virtual display the panel streams over VNC (`VncView`). The
 * browser's viewer fits Chrome's window to the panel; the desktop has a fixed
 * size the bot's coordinates depend on, so its viewer only scales it. Without
 * a VM the browser is headless (the bot can use it, there is nothing to
 * stream) and the computer is not set up, and the panel says so.
 *
 * The panel is one card: a header (title, connection status, view tools and
 * the hand-off control) over the viewport. Takeover is explicit: the viewer
 * is view-only while the bot drives, and "Take control" flips the server's
 * driver flag, which pauses the bot's tools (and the computer's
 * screenshots). "Release control" hands it back. When a bot asked for the
 * takeover itself, the panel says what it asked for.
 */
import type { CSSProperties, ReactNode } from "react";
import {
  Bot as BotIcon,
  ClipboardPaste,
  Hand,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MonitorOff,
  MousePointerClick,
  RotateCcw,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Card, CardTitle, EmptyState, ErrorState, LoadingSpinner, Text } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import type { Bot } from "../../../shared/api/bots";
import { connectionOf, useLiveView, usePanelWidth } from "../../lib/live-view";
import { useIsGuest } from "../../store/people";
import { VncView } from "../browser/VncView";
import type { LiveSurface, PageItem, PanelStatus } from "./surface";

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

/** A guest's viewer never resizes the remote window. */
const keepSize = async () => undefined;

export interface LivePanelProps {
  bot: Bot;
  onClose: () => void;
  /** The live view's Browser / Computer switch, in place of the title, when the chat has both. */
  tabs?: ReactNode;
}

export function LivePanel<S extends PanelStatus, L, I extends PageItem>({
  surface,
  bot,
  onClose,
  tabs,
}: LivePanelProps & { surface: LiveSurface<S, L, I> }) {
  const { kind, panel } = surface;
  const guest = useIsGuest();
  // Desktop only: drag the left edge to size the panel.
  const { width, startResize } = usePanelWidth(panel.width.key, panel.width.initial);
  const view = useLiveView<S, S>({
    kind,
    source: bot.id,
    // The session may start on the bot's first tool call, or from the panel's
    // open button; the poll follows either, and a takeover request flips the
    // driver from the server side.
    load: () => panel.api.status(bot.id),
    select: (status) => status,
    replace: (_, status) => status,
    driver: (driver) => panel.api.driver(bot.id, driver),
    start: () => panel.api.start(bot.id),
    reset: () => panel.api.reset(bot.id),
    startFailed: panel.startFailed,
    resetCopy: (status) => panel.resetCopy(status),
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
    start: open,
    reset,
    paste,
  } = view;

  const starting = Boolean(status?.starting);
  const mode = status ? panel.mode(status) : null;
  const streaming = mode === "vnc";
  const configured = !panel.setup || (status !== null && panel.setup.configured(status));
  // Bots share one profile unless set to their own, so a reset can reach
  // every one of them.
  const shared = status?.profile !== "own";

  const connection = connectionOf(status && { configured, starting, mode }, vncState);
  const detail = status && mode ? panel.detail(status, { mode, humanDrives }) : null;
  const takeover = panel.takeover && status?.takeover ? status.takeover : null;

  // The panel itself is the full-screen element: its box has to be the whole
  // screen, with nothing around the card, so the viewport (and the remote
  // window fitted to it) fills the display. Docked beside the chat only
  // where both fit (xl, and never wider than the viewport leaves after the
  // sidebar and a 26rem chat); narrower screens get the panel over the chat,
  // closable, like phones (#89).
  const sizing = fullscreen ? "fixed inset-0 z-40 w-full bg-background" : panel.width.docked;
  const surfaceClass = fullscreen ? "rounded-none ring-0" : "max-xl:rounded-none max-xl:ring-0";

  return (
    <div
      ref={panelRef}
      className={cn("relative flex flex-col", sizing)}
      style={{ [panel.width.cssVar]: `${width}px` } as CSSProperties}
      data-testid={`${kind}-panel`}
    >
      {!fullscreen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={panel.resizeLabel}
          onPointerDown={startResize}
          className="absolute inset-y-0 left-0 z-10 hidden w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-border xl:block"
          data-testid={panel.resizeTestId}
        />
      )}

      <Card size="sm" className={cn("min-h-0 flex-1 gap-0 py-0", surfaceClass)}>
        <header className="@container flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {tabs ?? <CardTitle>{panel.title}</CardTitle>}
            <Text variant="meta" className="flex min-w-0 items-center gap-1.5" aria-live="polite">
              <span className={cn("size-1.5 shrink-0 rounded-full", connection.dot)} aria-hidden />
              <span className="shrink-0 font-medium text-foreground">{connection.label}</span>
              {mode && (
                <span className={statusPart} data-testid={`${kind}-driver`}>
                  {humanDrives ? "You drive" : `${bot.name} drives`}
                </span>
              )}
              {detail && (
                <span
                  className={detail.grow ? cn(statusPart, "flex-1") : statusPart}
                  data-testid={detail.testId}
                >
                  {detail.text}
                </span>
              )}
            </Text>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {streaming &&
              !guest &&
              (humanDrives ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className={handoffButton}
                  onClick={() => void setDriver("agent")}
                  aria-label="Release control"
                  title={panel.releaseTitle(bot.name)}
                  data-testid={`${kind}-release`}
                >
                  <BotIcon />
                  <span className={handoffLabel}>
                    {takeover && panel.takeover ? panel.takeover.done : "Release control"}
                  </span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  className={handoffButton}
                  onClick={() => void setDriver("human")}
                  aria-label="Take control"
                  title={panel.takeTitle(bot.name)}
                  data-testid={`${kind}-takeover`}
                >
                  <MousePointerClick />
                  <span className={handoffLabel}>Take control</span>
                </Button>
              ))}
            {streaming && humanDrives && !guest && (
              <Button
                variant="ghost"
                size="sm"
                className={toolButton}
                onClick={paste}
                aria-label="Paste from your clipboard"
                title="Paste from your clipboard"
                data-testid={`${kind}-paste`}
              >
                <ClipboardPaste />
                <span className={toolLabel}>Paste</span>
              </Button>
            )}
            {streaming && (
              <Button
                variant="ghost"
                size="sm"
                className={toolButton}
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                title={fullscreen ? "Exit full screen" : "Full screen"}
                data-testid={`${kind}-fullscreen`}
              >
                {fullscreen ? <Minimize2 /> : <Maximize2 />}
                <span className={toolLabel}>{fullscreen ? "Exit full screen" : "Full screen"}</span>
              </Button>
            )}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
            {configured && (panel.openPage.forGuests || !guest) && (
              <Button variant="ghost" size="icon-sm" asChild>
                <Link
                  to={panel.openPage.to(status, bot)}
                  aria-label={panel.openPage.label}
                  title={panel.openPage.label}
                  data-testid={`${kind}-open-page`}
                >
                  <SquareArrowOutUpRight className="size-3.5" />
                </Link>
              </Button>
            )}
            {configured && !guest && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void reset()}
                aria-label={panel.reset.label}
                title={panel.reset.title(shared)}
                data-testid={`${kind}-reset`}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={panel.closeLabel}
              title="Close panel"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </header>

        {streaming && humanDrives && takeover && panel.takeover && (
          <div
            className="flex shrink-0 items-start gap-2 border-b bg-primary/5 px-4 py-2 text-sm"
            data-testid={`${kind}-takeover-reason`}
          >
            <Hand className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="font-medium">{bot.name} asked you:</span> {takeover}{" "}
              <span className="text-muted-foreground">{panel.takeover.note}</span>
            </span>
          </div>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden" data-testid={`${kind}-viewport`}>
          {streaming && (
            <VncView
              ref={vncRef}
              botId={bot.id}
              kind={kind}
              interactive={humanDrives && !guest}
              // A guest watches at the remote window's size; only the owner fits it (S2).
              resize={surface.fitsWindow && guest ? keepSize : undefined}
              onState={setVncState}
            />
          )}
          {streaming && vncState !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {vncState === "connecting" ? panel.connecting : "Reconnecting…"}
            </div>
          )}

          {mode === "headless" && panel.headless && (
            <div className="h-full" data-testid={`${kind}-headless`}>
              <EmptyState
                icon={MonitorOff}
                title={panel.headless.title}
                description={<span className={noteClass}>{panel.headless.note(bot.name)}</span>}
                className="h-full py-6"
              />
            </div>
          )}
          {status && panel.setup && !configured && (
            <EmptyState
              icon={MonitorOff}
              title={panel.setup.title}
              description={
                <span className={noteClass} data-testid={`${kind}-setup-hint`}>
                  {panel.setup.hint(status)}
                </span>
              }
              className="h-full py-6"
            />
          )}

          {configured && !mode && starting && (
            <EmptyState
              icon={panel.off.icon}
              title={
                status?.phase === "installing" ? panel.off.installing.title : panel.off.starting
              }
              description={
                <span className={noteClass}>
                  {status?.phase === "installing"
                    ? panel.off.installing.description
                    : "This takes a few seconds."}
                </span>
              }
              action={<LoadingSpinner size="sm" />}
              className="h-full py-6"
            />
          )}
          {configured && !mode && !starting && status?.error && (
            <ErrorState
              title={panel.off.failed}
              description={
                <span className={cn(noteClass, "break-words")} data-testid={`${kind}-error`}>
                  {status.error}
                </span>
              }
              action={
                guest ? undefined : (
                  <Button size="sm" onClick={() => void open()} data-testid={`${kind}-open`}>
                    Try again
                  </Button>
                )
              }
              className="h-full py-6"
            />
          )}
          {configured && !mode && !starting && !status?.error && (
            <EmptyState
              icon={panel.off.icon}
              title={panel.off.closed.title}
              description={panel.off.closed.description(bot.name)}
              action={
                guest ? undefined : (
                  <Button size="sm" onClick={() => void open()} data-testid={`${kind}-open`}>
                    {panel.off.closed.open}
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
