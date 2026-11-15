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
 * The panel is one card: a one-row header (title or tabs, one status chip,
 * icon tools) over the viewport. Takeover is explicit but direct: the viewer
 * is view-only while the bot drives, and a click on the stream takes control,
 * flipping the server's driver flag, which pauses the bot's tools (and the
 * computer's screenshots). While the owner drives, a frame marks the stream
 * as theirs and "Hand back" returns it. When a bot asked for the takeover
 * itself, the panel says what it asked for.
 */
import type { CSSProperties, ReactNode } from "react";
import { Card } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import type { Bot } from "../../../shared/api/bots";
import { connectionOf, useLiveView, usePanelWidth } from "../../lib/live-view";
import { useIsGuest } from "../../store/people";
import { VncView, type VncState } from "../browser/VncView";
import { ConnectingOverlay, DrivingFrame, TakeControlLayer, TakeoverBanner } from "./live-parts";
import { LivePanelHeader } from "./LivePanelHeader";
import { LivePanelOffStates } from "./LivePanelOffStates";
import type { LivePanelSurface, LiveSurface, PageItem, PanelStatus } from "./surface";

/** A guest's viewer never resizes the remote window. */
const keepSize = async () => undefined;

/** What the panel shows for `status`: its mode, whether it is set up, the status chip's parts. */
function panelState<S extends PanelStatus>(
  panel: LivePanelSurface<S>,
  status: S | null,
  vncState: VncState,
) {
  const starting = Boolean(status?.starting);
  const mode = status ? panel.mode(status) : null;
  const streaming = mode === "vnc";
  const configured = !panel.setup || (status !== null && panel.setup.configured(status));
  // Bots share one profile unless set to their own, so a reset can reach
  // every one of them.
  const shared = status?.profile !== "own";

  const connection = connectionOf(status && { configured, starting, mode }, vncState);
  const live = streaming && vncState === "live";
  const detail = status && mode === "headless" ? (panel.headlessDetail?.(status) ?? null) : null;
  const takeover = panel.takeover && status?.takeover ? status.takeover : null;
  return {
    starting,
    mode,
    streaming,
    live,
    configured,
    shared,
    connection,
    detail,
    takeover,
  };
}

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

  const { starting, mode, streaming, live, configured, shared, connection, detail, takeover } =
    panelState(panel, status, vncState);

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
        <LivePanelHeader
          kind={kind}
          panel={panel}
          bot={bot}
          tabs={tabs}
          status={status}
          guest={guest}
          connection={connection}
          live={live}
          detail={detail}
          takeover={takeover}
          streaming={streaming}
          humanDrives={humanDrives}
          configured={configured}
          shared={shared}
          fullscreen={fullscreen}
          onDriver={(driver) => void setDriver(driver)}
          onPaste={paste}
          onToggleFullscreen={toggleFullscreen}
          onReset={() => void reset()}
          onClose={onClose}
        />

        {streaming && humanDrives && takeover && panel.takeover && (
          <TakeoverBanner
            testId={`${kind}-takeover-reason`}
            asked={<>{bot.name} asked you:</>}
            reason={takeover}
            note={panel.takeover.note}
          />
        )}

        {/* The card's bottom corners, so the driving frame follows them. */}
        <div
          className="relative min-h-0 flex-1 overflow-hidden rounded-b-[inherit]"
          data-testid={`${kind}-viewport`}
        >
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
            <ConnectingOverlay vncState={vncState} connecting={panel.connecting} />
          )}
          {live && !humanDrives && !guest && (
            <TakeControlLayer
              testId={`${kind}-takeover`}
              title={panel.takeTitle(bot.name)}
              onTake={() => void setDriver("human")}
            />
          )}
          {live && humanDrives && <DrivingFrame testId={`${kind}-driving-frame`} />}

          <LivePanelOffStates
            kind={kind}
            panel={panel}
            bot={bot}
            status={status}
            mode={mode}
            configured={configured}
            starting={starting}
            guest={guest}
            onOpen={() => void open()}
          />
        </div>
      </Card>
    </div>
  );
}
