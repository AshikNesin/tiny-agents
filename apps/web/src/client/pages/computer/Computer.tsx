/**
 * Computer page: the bots' desktops on the sandbox VM, in the app, the way
 * the Terminal page gives the owner the VM's shells. One tab per desktop:
 * the shared one, and one per bot with a browser profile of its own.
 *
 * The view is the chat panel's (`VncView`, kind `computer`): the fixed-size
 * desktop scaled to the page, view-only until the owner takes control.
 * Taking control is the same driver flag the panel flips, so the bots on
 * that desktop pause and take no screenshots until it is handed back, and a
 * bot's takeover request is answered by the hand-back here too. While
 * driving, the owner can open apps and send the shortcuts the local browser
 * would keep for itself (Alt+Tab, Alt+F4, Ctrl+W).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AppWindow,
  Bot as BotIcon,
  ClipboardPaste,
  Hand,
  Keyboard,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Monitor,
  MonitorOff,
  MousePointerClick,
  RotateCcw,
} from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingSpinner, LoadingState } from "@groot/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/shell/lib/utils";
import { useConfirm } from "@groot/ui/primitives";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import {
  computerApi,
  type Desktop,
  type DesktopApp,
  type DesktopList,
} from "../../lib/computer-api";
import { DESKTOP_SHORTCUTS } from "../../lib/desktop-keys";
import { errorMessage } from "../../lib/errors";
import { VncView, type VncHandle, type VncState } from "../../components/browser/VncView";

const SELECTED_KEY = "tiny-agents:computer-desktop";
/** Keys the desktop should get in full screen instead of the page reacting. */
const LOCKED_KEYS = ["Escape", "Tab", "KeyW", "KeyT", "KeyN", "KeyQ", "F4", "F5"];

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

function readSelected(): string {
  try {
    return window.localStorage.getItem(SELECTED_KEY) ?? "shared";
  } catch {
    return "shared";
  }
}

function storeSelected(profile: string): void {
  try {
    window.localStorage.setItem(SELECTED_KEY, profile);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/** Who uses a desktop, for its tab: "3 bots", "Scout", "no bots yet". */
function usersOf(desktop: Desktop): string {
  if (desktop.profile !== "shared") return "own desktop";
  const count = desktop.bots.length;
  return count === 0 ? "no bots yet" : count === 1 ? desktop.bots[0]!.name : `${count} bots`;
}

/** The Apps menu: the desktop's applications, loaded when it opens. */
function AppsMenu({ profile, disabled }: { profile: string; disabled: boolean }) {
  const [apps, setApps] = useState<DesktopApp[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      setApps((await computerApi.apps(profile)).apps);
    } catch (error) {
      setApps([]);
      toast.error(errorMessage(error, "Could not list the apps"));
    }
  };

  const launch = async (app: DesktopApp) => {
    try {
      await computerApi.openApp(profile, app.id);
      toast.success(`Opening ${app.name}…`);
    } catch (error) {
      toast.error(errorMessage(error, `Could not open ${app.name}`));
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={disabled ? "Take control to open apps" : "Open an app on this desktop"}
          data-testid="computer-apps"
        >
          <AppWindow />
          Apps
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>Open an app</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {apps === null && (
          <div className="flex justify-center py-3">
            <LoadingSpinner size="sm" />
          </div>
        )}
        {apps?.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No apps found.</div>
        )}
        {apps?.map((app) => (
          <DropdownMenuItem key={app.id} onSelect={() => void launch(app)}>
            {app.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The Keys menu: desktop shortcuts the local browser would otherwise keep. */
function KeysMenu({ disabled, onSend }: { disabled: boolean; onSend: (index: number) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={disabled ? "Take control to send keys" : "Send a shortcut to the desktop"}
          data-testid="computer-keys"
        >
          <Keyboard />
          Keys
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Send to the desktop</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DESKTOP_SHORTCUTS.map((shortcut, index) => (
          <DropdownMenuItem key={shortcut.keys} onSelect={() => onSend(index)}>
            <span className="flex-1">{shortcut.label}</span>
            <span className="text-xs text-muted-foreground">{shortcut.keys}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What the view area shows for a desktop that is not live. */
function OffState({ desktop, onOpen }: { desktop: Desktop; onOpen: () => void }) {
  if (desktop.starting) {
    return (
      <EmptyState
        icon={Monitor}
        title={
          desktop.phase === "installing"
            ? "Setting up the computer on the VM"
            : "Starting the desktop"
        }
        description={
          desktop.phase === "installing"
            ? "First run only: installing the desktop and its tools. This takes a few minutes."
            : "This takes a few seconds."
        }
        action={<LoadingSpinner size="sm" />}
        className="h-full py-6"
      />
    );
  }
  if (desktop.error) {
    return (
      <ErrorState
        title="Couldn't start the desktop"
        description={
          <span className="mx-auto block max-w-sm break-words" data-testid="computer-page-error">
            {desktop.error}
          </span>
        }
        action={
          <Button size="sm" onClick={onOpen}>
            Try again
          </Button>
        }
        className="h-full py-6"
      />
    );
  }
  return (
    <EmptyState
      icon={Monitor}
      title="This desktop is off."
      description="It also starts when a bot that uses it first needs the computer."
      action={
        <Button size="sm" onClick={onOpen} data-testid="computer-page-open">
          Start desktop
        </Button>
      }
      className="h-full py-6"
    />
  );
}

export function ComputerPage() {
  const [list, setList] = useState<DesktopList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState(readSelected);
  const [vncState, setVncState] = useState<VncState>("connecting");
  const [fullscreen, setFullscreen] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const vncRef = useRef<VncHandle>(null);
  const confirm = useConfirm();

  const refresh = useCallback(async () => {
    try {
      setList(await computerApi.list());
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Failed to load the desktops"));
    }
  }, []);

  const desktops = list?.desktops ?? [];
  const desktop = desktops.find((d) => d.profile === selected) ?? desktops[0];
  const profile = desktop?.profile;
  const live = Boolean(desktop?.active);
  const driving = desktop?.driver === "human";

  // Desktops start, stop and change hands from other tabs and from bots.
  const pollMs = desktops.some((d) => d.starting) ? 1500 : 3000;
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!live) setVncState("connecting");
  }, [live, profile]);

  useEffect(() => {
    const onChange = () => {
      const full = document.fullscreenElement === regionRef.current;
      setFullscreen(full);
      const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
      if (full) void keyboard?.lock?.(LOCKED_KEYS).catch(() => undefined);
      else keyboard?.unlock?.();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const select = (next: string) => {
    setSelected(next);
    storeSelected(next);
  };

  const patch = (next: Partial<Desktop>) =>
    setList((current) =>
      current
        ? {
            ...current,
            desktops: current.desktops.map((d) => (d.profile === profile ? { ...d, ...next } : d)),
          }
        : current,
    );

  const setDriver = async (driver: "agent" | "human") => {
    if (!profile) return;
    try {
      await computerApi.driver(profile, driver);
      patch({ driver, ...(driver === "agent" ? { takeover: null } : {}) });
      if (driver === "human") vncRef.current?.focus();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to switch driver"));
    }
  };

  const start = async () => {
    if (!profile) return;
    try {
      await computerApi.start(profile);
      patch({ starting: true, error: null });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to start the desktop"));
    }
  };

  const reset = async () => {
    if (!desktop || !profile) return;
    const ok = await confirm({
      title: `Reset the ${desktop.label} desktop?`,
      description:
        "This closes the desktop and deletes its settings and app state on the VM" +
        (desktop.bots.length > 1 ? ", for every bot that uses it" : "") +
        ". Files in the home folder stay.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    try {
      await computerApi.reset(profile);
      patch({ active: false, driver: null, takeover: null });
      toast.success("Desktop reset; it starts fresh next time.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to reset"));
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    const region = regionRef.current;
    if (!region?.requestFullscreen) {
      toast.error("Full screen is not available in this browser.");
      return;
    }
    void region.requestFullscreen().catch(() => toast.error("Could not enter full screen."));
  };

  const paste = () => {
    void vncRef.current?.paste().catch(() => {
      toast.error("Could not read the clipboard. Allow clipboard access and try again.");
    });
  };

  const sendShortcut = (index: number) => {
    const shortcut = DESKTOP_SHORTCUTS[index];
    if (!shortcut) return;
    vncRef.current?.sendKeys(shortcut.strokes);
    vncRef.current?.focus();
  };

  // A stable ticket source per desktop, so the viewer reconnects only on a switch.
  const ticket = useCallback(() => computerApi.ticket(profile ?? "shared"), [profile]);

  const body = (() => {
    if (loadError && !list) {
      return (
        <ErrorState
          title="Couldn't load the computer"
          description={loadError}
          action={
            <Button size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        />
      );
    }
    if (!list) return <LoadingState text="Loading desktops…" />;
    if (!list.configured) {
      return (
        <EmptyState
          icon={MonitorOff}
          title="No computer on this server"
          description={
            <span className="mx-auto block max-w-sm" data-testid="computer-page-setup">
              {list.setupHint ?? "The computer is not configured."}
            </span>
          }
        />
      );
    }
    return (
      <div
        ref={regionRef}
        className={cn(
          "flex flex-col overflow-hidden rounded-xl bg-background ring-1 ring-border",
          fullscreen ? "rounded-none ring-0" : "md:h-[calc(100dvh-15rem)]",
        )}
        data-testid="computer-region"
      >
        <div
          role="tablist"
          aria-label="Desktops"
          className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/40 px-1 pt-1"
        >
          {desktops.map((d) => {
            const isActive = d.profile === profile;
            return (
              <button
                key={d.profile}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => select(d.profile)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-sm",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                data-testid={`computer-tab-${d.profile}`}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    d.active
                      ? d.driver === "human"
                        ? "bg-primary"
                        : "bg-success"
                      : d.starting
                        ? "animate-pulse bg-warning"
                        : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                <span className="font-medium">{d.label}</span>
                <span className="text-xs opacity-60">{usersOf(d)}</span>
                {d.takeover && <Hand className="size-3.5 text-primary" aria-label="Needs you" />}
              </button>
            );
          })}
        </div>

        {live && driving && desktop?.takeover && (
          <div
            className="flex shrink-0 items-start gap-2 border-b bg-primary/5 px-4 py-2 text-sm"
            data-testid="computer-page-takeover"
          >
            <Hand className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="font-medium">A bot asked you:</span> {desktop.takeover}{" "}
              <span className="text-muted-foreground">
                It sees nothing until you release control.
              </span>
            </span>
          </div>
        )}

        <div
          className={cn(
            "relative w-full flex-1 overflow-hidden",
            fullscreen ? "min-h-0" : "h-[60vh] min-h-[320px] md:h-auto md:min-h-0",
          )}
          data-testid="computer-page-viewport"
        >
          {live && profile && (
            <VncView
              key={profile}
              ref={vncRef}
              botId={profile}
              kind="computer"
              ticket={ticket}
              interactive={driving}
              onState={setVncState}
            />
          )}
          {live && vncState !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {vncState === "connecting" ? "Connecting to the desktop…" : "Reconnecting…"}
            </div>
          )}
          {live && vncState === "live" && !driving && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <Button
                size="sm"
                className="pointer-events-auto shadow-md"
                onClick={() => void setDriver("human")}
                data-testid="computer-page-takeover-hint"
              >
                <MousePointerClick />
                View only · Take control to use it
              </Button>
            </div>
          )}
          {!live && desktop && <OffState desktop={desktop} onOpen={() => void start()} />}
        </div>
      </div>
    );
  })();

  const configured = Boolean(list?.configured && desktop);

  return (
    <PageLayout
      title="Computer"
      description="The bots' desktops on the sandbox VM. Take control to use one yourself; bots on it wait."
      maxWidth="full"
      actions={
        configured ? (
          <>
            {live && (
              <>
                <AppsMenu key={profile} profile={profile!} disabled={!driving} />
                <KeysMenu disabled={!driving} onSend={sendShortcut} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={paste}
                  disabled={!driving}
                  aria-label="Paste from your clipboard"
                  title="Paste from your clipboard"
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="computer-page-paste"
                >
                  <ClipboardPaste className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleFullscreen}
                  aria-label={fullscreen ? "Exit full screen" : "Full screen"}
                  title={fullscreen ? "Exit full screen" : "Full screen"}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="computer-page-fullscreen"
                >
                  {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void reset()}
              aria-label="Reset desktop"
              title="Close this desktop and wipe its settings"
              className="text-muted-foreground hover:text-foreground"
              data-testid="computer-page-reset"
            >
              <RotateCcw className="size-4" />
            </Button>
            {live &&
              (driving ? (
                <Button
                  variant="secondary"
                  onClick={() => void setDriver("agent")}
                  data-testid="computer-page-release"
                >
                  <BotIcon />
                  Release control
                </Button>
              ) : (
                <Button onClick={() => void setDriver("human")} data-testid="computer-page-take">
                  <MousePointerClick />
                  Take control
                </Button>
              ))}
          </>
        ) : undefined
      }
    >
      {body}
    </PageLayout>
  );
}
