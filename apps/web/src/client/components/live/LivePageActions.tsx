/**
 * The page header's actions for the selected browser or desktop: while it
 * streams, the Apps and Keys menus (the computer's), paste and full screen;
 * then reset, and the hand-off control.
 */
import {
  Bot as BotIcon,
  ClipboardPaste,
  Maximize2,
  Minimize2,
  MousePointerClick,
  RotateCcw,
} from "lucide-react";
import { Button } from "@groot/ui";
import type { Driver, LiveViewKind } from "../../lib/live-view";
import { AppsMenu, KeysMenu } from "./LivePageMenus";
import type { LivePageSurface, PageItem } from "./surface";

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
  return (
    <>
      {streaming && (
        <>
          {page.apps && (
            <AppsMenu
              key={profile}
              apps={page.apps}
              profile={profile!}
              disabled={!driving}
              testId={`${kind}-apps`}
            />
          )}
          {page.keys && (
            <KeysMenu
              shortcuts={page.keys}
              disabled={!driving}
              onSend={onSendShortcut}
              testId={`${kind}-keys`}
            />
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onPaste}
            disabled={!driving}
            aria-label="Paste from your clipboard"
            title="Paste from your clipboard"
            className="text-muted-foreground hover:text-foreground"
            data-testid={`${kind}-page-paste`}
          >
            <ClipboardPaste className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            title={fullscreen ? "Exit full screen" : "Full screen"}
            className="text-muted-foreground hover:text-foreground"
            data-testid={`${kind}-page-fullscreen`}
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onReset}
        aria-label={page.reset.label}
        title={page.reset.title}
        className="text-muted-foreground hover:text-foreground"
        data-testid={`${kind}-page-reset`}
      >
        <RotateCcw className="size-4" />
      </Button>
      {streaming &&
        (driving ? (
          <Button
            variant="secondary"
            onClick={() => onDriver("agent")}
            data-testid={`${kind}-page-release`}
          >
            <BotIcon />
            Release control
          </Button>
        ) : (
          <Button onClick={() => onDriver("human")} data-testid={`${kind}-page-take`}>
            <MousePointerClick />
            Take control
          </Button>
        ))}
    </>
  );
}
