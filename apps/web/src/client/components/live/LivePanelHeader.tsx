/**
 * The live-view panel's header: its title (or the Browser / Computer tabs)
 * over the status line, then the hand-off control, the view tools, the link
 * to the page, reset and close.
 */
import type { ReactNode } from "react";
import {
  Bot as BotIcon,
  ClipboardPaste,
  Maximize2,
  Minimize2,
  MousePointerClick,
  RotateCcw,
  SquareArrowOutUpRight,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, CardTitle, Text } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import type { Bot } from "../../../shared/api/bots";
import type { Connection, Driver, LiveViewKind } from "../../lib/live-view";
import type { LivePanelSurface, PanelStatus } from "./surface";

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

type HeaderProps<S extends PanelStatus> = {
  kind: LiveViewKind;
  panel: LivePanelSurface<S>;
  bot: Bot;
  tabs: ReactNode | undefined;
  status: S | null;
  guest: boolean;
  connection: Connection;
  mode: "vnc" | "headless" | null;
  detail: ReturnType<LivePanelSurface<S>["detail"]>;
  takeover: string | null;
  streaming: boolean;
  humanDrives: boolean;
  configured: boolean;
  shared: boolean;
  fullscreen: boolean;
  onDriver: (driver: Driver) => void;
  onPaste: () => void;
  onToggleFullscreen: () => void;
  onReset: () => void;
  onClose: () => void;
};

export function LivePanelHeader<S extends PanelStatus>(props: HeaderProps<S>) {
  return (
    <header className="@container flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
      <PanelTitle {...props} />

      <PanelTools {...props} />
    </header>
  );
}

/** The title (or the tabs) over the connection, who drives and the detail. */
function PanelTitle<S extends PanelStatus>({
  kind,
  panel,
  bot,
  tabs,
  connection,
  mode,
  detail,
  humanDrives,
}: HeaderProps<S>) {
  return (
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
  );
}

/** The hand-off control, paste and full screen, then the page link, reset and close. */
function PanelTools<S extends PanelStatus>(props: HeaderProps<S>) {
  const {
    kind,
    panel,
    bot,
    status,
    guest,
    streaming,
    humanDrives,
    configured,
    shared,
    fullscreen,
    onPaste,
    onToggleFullscreen,
    onReset,
    onClose,
  } = props;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {streaming && !guest && <HandoffControl {...props} />}
      {streaming && humanDrives && !guest && (
        <Button
          variant="ghost"
          size="sm"
          className={toolButton}
          onClick={onPaste}
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
          onClick={onToggleFullscreen}
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
          onClick={onReset}
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
  );
}

/** Take control, or hand it back (a takeover's hand-back says it is done). */
function HandoffControl<S extends PanelStatus>({
  kind,
  panel,
  bot,
  takeover,
  humanDrives,
  onDriver,
}: HeaderProps<S>) {
  return humanDrives ? (
    <Button
      size="sm"
      variant="secondary"
      className={handoffButton}
      onClick={() => onDriver("agent")}
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
      onClick={() => onDriver("human")}
      aria-label="Take control"
      title={panel.takeTitle(bot.name)}
      data-testid={`${kind}-takeover`}
    >
      <MousePointerClick />
      <span className={handoffLabel}>Take control</span>
    </Button>
  );
}
