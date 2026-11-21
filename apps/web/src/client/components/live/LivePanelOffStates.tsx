import { MonitorOff } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingSpinner } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import type { Bot } from "../../../shared/api/bots";
import type { LiveViewKind } from "../../lib/live-view";
import type { LivePanelSurface, PanelStatus } from "./surface";

const noteClass = "mx-auto block max-w-sm";

type OffProps<S extends PanelStatus> = {
  kind: LiveViewKind;
  panel: LivePanelSurface<S>;
  bot: Bot;
  status: S | null;
  mode: "vnc" | "headless" | null;
  configured: boolean;
  starting: boolean;
  guest: boolean;
  onOpen: () => void;
};

export function LivePanelOffStates<S extends PanelStatus>(props: OffProps<S>) {
  return (
    <>
      <NothingToStream {...props} />

      <NotOpen {...props} />
    </>
  );
}

function NothingToStream<S extends PanelStatus>({
  kind,
  panel,
  bot,
  status,
  mode,
  configured,
}: OffProps<S>) {
  return (
    <>
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
    </>
  );
}

function NotOpen<S extends PanelStatus>({
  kind,
  panel,
  bot,
  status,
  mode,
  configured,
  starting,
  guest,
  onOpen,
}: OffProps<S>) {
  return (
    <>
      {configured && !mode && starting && (
        <EmptyState
          icon={panel.off.icon}
          title={status?.phase === "installing" ? panel.off.installing.title : panel.off.starting}
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
              <Button size="sm" onClick={onOpen} data-testid={`${kind}-open`}>
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
              <Button size="sm" onClick={onOpen} data-testid={`${kind}-open`}>
                {panel.off.closed.open}
              </Button>
            )
          }
          className="h-full py-6"
        />
      )}
    </>
  );
}
