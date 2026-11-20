import { useState, type CSSProperties, type ReactNode } from "react";
import { Card } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import type { Bot } from "../../../shared/api/bots";
import type { LiveLayout } from "../../lib/browser-panel";
import { connectionOf, useLiveView, usePanelWidth, usePipPosition } from "../../lib/live-view";
import { useIsGuest } from "../../store/people";
import { VncView, type VncState } from "../browser/VncView";
import { ConnectingOverlay, DrivingFrame, TakeControlLayer, TakeoverBanner } from "./live-parts";
import { LivePanelHeader } from "./LivePanelHeader";
import { LivePanelOffStates } from "./LivePanelOffStates";
import type { LivePanelSurface, LiveSurface, PageItem, PanelStatus } from "./surface";

const keepSize = async () => undefined;

function panelState<S extends PanelStatus>(
  panel: LivePanelSurface<S>,
  status: S | null,
  vncState: VncState,
) {
  const starting = Boolean(status?.starting);
  const mode = status ? panel.mode(status) : null;
  const streaming = mode === "vnc";
  const configured = !panel.setup || (status !== null && panel.setup.configured(status));
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
  tabs?: ReactNode;
  layout?: LiveLayout;
  onLayout?: (layout: LiveLayout) => void;
}

function pipShape(display: { width: number; height: number } | null) {
  const aspect = display
    ? Math.min(16 / 9, Math.max(1 / 2, display.width / display.height))
    : 16 / 10;
  const width = `min(20rem, calc(100vw - 4rem), ${(18 * aspect).toFixed(2)}rem)`;
  return { aspect, width };
}

const PIP_SIZING = "fixed z-40 rounded-xl shadow-xl";

export function LivePanel<S extends PanelStatus, L, I extends PageItem>({
  surface,
  bot,
  onClose,
  tabs,
  layout = "docked",
  onLayout,
}: LivePanelProps & { surface: LiveSurface<S, L, I> }) {
  const { kind, panel } = surface;
  const guest = useIsGuest();
  const { width, startResize } = usePanelWidth(panel.width.key, panel.width.initial);
  const view = useLiveView<S, S>({
    kind,
    source: bot.id,
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

  const pip = layout === "pip" && !fullscreen;
  const [display, setDisplay] = useState<{ width: number; height: number } | null>(null);
  const { offset, startDrag } = usePipPosition(panelRef);
  const sizing = fullscreen
    ? "fixed inset-0 z-40 w-full bg-background"
    : pip
      ? PIP_SIZING
      : panel.width.docked;
  const surfaceClass = fullscreen
    ? "rounded-none ring-0"
    : pip
      ? ""
      : "max-xl:rounded-none max-xl:ring-0";
  const shape = pipShape(display);
  const pipStyle: CSSProperties = {
    width: shape.width,
    right: `max(8px, min(${offset.right}px, calc(100vw - ${shape.width} - 8px)))`,
    bottom: `max(8px, min(${offset.bottom}px, calc(100dvh - 21rem)))`,
  };

  return (
    <div
      ref={panelRef}
      className={cn("relative flex flex-col", sizing)}
      style={{ [panel.width.cssVar]: `${width}px`, ...(pip ? pipStyle : {}) } as CSSProperties}
      data-testid={`${kind}-panel`}
      data-layout={pip ? "pip" : "docked"}
    >
      {!fullscreen && !pip && (
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
          pip={pip}
          onDrag={startDrag}
          onLayout={onLayout}
          onDriver={(driver) => void setDriver(driver)}
          onPaste={paste}
          onToggleFullscreen={toggleFullscreen}
          onReset={() => void reset()}
          onClose={onClose}
        />

        {streaming && humanDrives && takeover && panel.takeover && !pip && (
          <TakeoverBanner
            testId={`${kind}-takeover-reason`}
            asked={<>{bot.name} asked you:</>}
            reason={takeover}
            note={panel.takeover.note}
          />
        )}

        <div
          className={cn(
            "relative min-h-0 overflow-hidden rounded-b-[inherit]",
            pip ? "shrink-0" : "flex-1",
          )}
          style={pip ? { aspectRatio: shape.aspect } : undefined}
          data-testid={`${kind}-viewport`}
        >
          {streaming && (
            <VncView
              ref={vncRef}
              botId={bot.id}
              kind={kind}
              interactive={humanDrives && !guest && !pip}
              resize={surface.fitsWindow && (guest || pip) ? keepSize : undefined}
              remoteResize={!pip}
              onDisplaySize={setDisplay}
              onState={setVncState}
            />
          )}
          {streaming && vncState !== "live" && (
            <ConnectingOverlay vncState={vncState} connecting={panel.connecting} />
          )}
          {pip && live && onLayout && (
            <button
              type="button"
              onClick={() => onLayout("docked")}
              aria-label="Expand live view"
              title="Expand"
              className="absolute inset-0 cursor-pointer outline-none hover:bg-foreground/5 focus-visible:bg-foreground/5"
              data-testid={`${kind}-pip-expand-stream`}
            />
          )}
          {!pip && live && !humanDrives && !guest && (
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
