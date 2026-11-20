import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  ClipboardPaste,
  Maximize2,
  Minimize2,
  PanelRightOpen,
  PictureInPicture2,
  RotateCcw,
  SquareArrowOutUpRight,
  Undo2,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, CardTitle } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import type { LiveLayout } from "../../lib/browser-panel";
import type { Bot } from "../../../shared/api/bots";
import type { Connection, Driver, LiveViewKind } from "../../lib/live-view";
import { StatusChip } from "./live-parts";
import type { LivePanelSurface, PanelStatus } from "./surface";

const tool = "text-muted-foreground hover:text-foreground";

type HeaderProps<S extends PanelStatus> = {
  kind: LiveViewKind;
  panel: LivePanelSurface<S>;
  bot: Bot;
  tabs: ReactNode | undefined;
  status: S | null;
  guest: boolean;
  connection: Connection;
  live: boolean;
  detail: { text: string; testId: string } | null;
  takeover: string | null;
  streaming: boolean;
  humanDrives: boolean;
  configured: boolean;
  shared: boolean;
  fullscreen: boolean;
  pip: boolean;
  onDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onLayout: ((layout: LiveLayout) => void) | undefined;
  onDriver: (driver: Driver) => void;
  onPaste: () => void;
  onToggleFullscreen: () => void;
  onReset: () => void;
  onClose: () => void;
};

export function LivePanelHeader<S extends PanelStatus>(props: HeaderProps<S>) {
  const { panel, tabs, detail, pip, onDrag } = props;
  return (
    <header
      className={cn(
        "@container flex shrink-0 items-center gap-2 border-b pr-1.5 pl-2",
        pip ? "h-10 cursor-grab touch-none select-none active:cursor-grabbing" : "h-11",
      )}
      onPointerDown={pip ? onDrag : undefined}
      data-testid={pip ? `${props.kind}-pip-handle` : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {tabs ?? <CardTitle className="pl-1 text-sm">{panel.title}</CardTitle>}
        <PanelChip {...props} />
        {detail && (
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            data-testid={detail.testId}
          >
            {detail.text}
          </span>
        )}
      </div>
      {pip ? <PipTools {...props} /> : <PanelTools {...props} />}
    </header>
  );
}

function PanelChip<S extends PanelStatus>({
  kind,
  bot,
  connection,
  live,
  humanDrives,
}: HeaderProps<S>) {
  return (
    <StatusChip
      connection={connection}
      live={live}
      yours={humanDrives}
      driver={humanDrives ? "You're driving" : `${bot.name} is driving`}
      driverTestId={`${kind}-driver`}
    />
  );
}

function PanelTools<S extends PanelStatus>({
  kind,
  panel,
  bot,
  status,
  guest,
  takeover,
  streaming,
  humanDrives,
  configured,
  shared,
  fullscreen,
  onLayout,
  onDriver,
  onPaste,
  onToggleFullscreen,
  onReset,
  onClose,
}: HeaderProps<S>) {
  const driving = streaming && humanDrives && !guest;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {driving && (
        <Button
          size="xs"
          variant="secondary"
          className="mr-1"
          onClick={() => onDriver("agent")}
          title={panel.releaseTitle(bot.name)}
          data-testid={`${kind}-release`}
        >
          <Undo2 />
          {takeover && panel.takeover ? panel.takeover.done : "Hand back"}
        </Button>
      )}
      {driving && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={tool}
          onClick={onPaste}
          aria-label="Paste from your clipboard"
          title="Paste from your clipboard"
          data-testid={`${kind}-paste`}
        >
          <ClipboardPaste className="size-3.5" />
        </Button>
      )}
      {streaming && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={tool}
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          data-testid={`${kind}-fullscreen`}
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      )}
      {onLayout && !fullscreen && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={tool}
          onClick={() => onLayout("pip")}
          aria-label="Picture in picture"
          title="Picture in picture"
          data-testid={`${kind}-pip`}
        >
          <PictureInPicture2 className="size-3.5" />
        </Button>
      )}
      {configured && (panel.openPage.forGuests || !guest) && (
        <Button variant="ghost" size="icon-sm" className={tool} asChild>
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
          className={tool}
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
        className={tool}
        onClick={onClose}
        aria-label={panel.closeLabel}
        title="Close panel"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function PipTools<S extends PanelStatus>({
  kind,
  panel,
  bot,
  guest,
  takeover,
  streaming,
  humanDrives,
  onLayout,
  onDriver,
  onClose,
}: HeaderProps<S>) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {streaming && humanDrives && !guest && (
        <Button
          size="xs"
          variant="secondary"
          className="mr-1"
          onClick={() => onDriver("agent")}
          title={panel.releaseTitle(bot.name)}
          data-testid={`${kind}-release`}
        >
          <Undo2 />
          {takeover && panel.takeover ? panel.takeover.done : "Hand back"}
        </Button>
      )}
      {onLayout && (
        <Button
          variant="ghost"
          size="icon-sm"
          className={tool}
          onClick={() => onLayout("docked")}
          aria-label="Expand live view"
          title="Expand"
          data-testid={`${kind}-pip-expand`}
        >
          <PanelRightOpen className="size-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className={tool}
        onClick={onClose}
        aria-label={panel.closeLabel}
        title="Close"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
