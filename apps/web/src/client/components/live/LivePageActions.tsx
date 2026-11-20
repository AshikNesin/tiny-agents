import { ClipboardPaste, Maximize2, Minimize2, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "@groot/ui";
import type { Driver, LiveViewKind } from "../../lib/live-view";
import { AppsMenu, KeysMenu } from "./LivePageMenus";
import type { LivePageSurface, PageItem } from "./surface";

const tool = "text-muted-foreground hover:text-foreground";

export function LivePageActions<L, I extends PageItem>({
  kind,
  page,
  profile,
  streaming,
  driving,
  fullscreen,
  onSendShortcut,
  onPaste,
  onToggleFullscreen,
  onReset,
  onDriver,
}: {
  kind: LiveViewKind;
  page: LivePageSurface<L, I>;
  profile: string | undefined;
  streaming: boolean;
  driving: boolean;
  fullscreen: boolean;
  onSendShortcut: (index: number) => void;
  onPaste: () => void;
  onToggleFullscreen: () => void;
  onReset: () => void;
  onDriver: (driver: Driver) => void;
}) {
  const yours = streaming && driving;
  return (
    <div className="ml-auto flex shrink-0 items-center gap-0.5">
      {yours && (
        <>
          <Button
            size="xs"
            variant="secondary"
            className="mr-1"
            onClick={() => onDriver("agent")}
            title="Hand it back to the bots"
            data-testid={`${kind}-page-release`}
          >
            <Undo2 />
            Hand back
          </Button>
          {page.apps && (
            <AppsMenu key={profile} apps={page.apps} profile={profile!} testId={`${kind}-apps`} />
          )}
          {page.keys && (
            <KeysMenu shortcuts={page.keys} onSend={onSendShortcut} testId={`${kind}-keys`} />
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onPaste}
            aria-label="Paste from your clipboard"
            title="Paste from your clipboard"
            className={tool}
            data-testid={`${kind}-page-paste`}
          >
            <ClipboardPaste className="size-3.5" />
          </Button>
        </>
      )}
      {streaming && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? "Exit full screen" : "Full screen"}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          className={tool}
          data-testid={`${kind}-page-fullscreen`}
        >
          {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onReset}
        aria-label={page.reset.label}
        title={page.reset.title}
        className={tool}
        data-testid={`${kind}-page-reset`}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  );
}
