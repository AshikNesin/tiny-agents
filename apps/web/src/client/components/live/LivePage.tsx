/**
 * The live-view page: the bots' browsers (issue #160) or desktops on the
 * sandbox VM, in the app, for the surface it is given (`surface.ts`). One
 * tab per browser or desktop: the shared one (the default, where a site
 * signed into once is signed in for every bot on it), and one per bot with a
 * profile of its own.
 *
 * The view is the chat panel's (`VncView`), fit to the page (the browser's
 * window) or scaled to it (the desktop's fixed size), view-only until the
 * owner takes control. Taking control is the same driver flag the panel
 * flips, so the bots on that browser or desktop wait (and take no
 * screenshots) until it is handed back, and a bot's takeover request is
 * answered by the hand-back here too. The browser's owner works in a tab of
 * their own (`owner` on the server), so opening the page never lands in a
 * bot's tab. While driving a desktop, the owner can open apps and send the
 * shortcuts the local browser would keep for itself (Alt+Tab, Alt+F4,
 * Ctrl+W).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import type { DesktopApp, ResizeBody } from "../../../shared/api/live";
import type { DesktopShortcut } from "../../lib/desktop-keys";
import { errorMessage } from "../../lib/errors";
import { connectionOf, useLiveView } from "../../lib/live-view";
import { VncView } from "../browser/VncView";
import type { AppsApi, LiveSurface, PageItem, PageOffCopy, PanelStatus } from "./surface";

function readSelected(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "shared";
  } catch {
    return "shared";
  }
}

function storeSelected(key: string, profile: string): void {
  try {
    window.localStorage.setItem(key, profile);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/** Who uses one, for its tab: "3 bots", "Scout", "no bots yet". */
function usersOf(item: PageItem, own: string): string {
  if (item.profile !== "shared") return own;
  const count = item.bots.length;
  return count === 0 ? "no bots yet" : count === 1 ? item.bots[0]!.name : `${count} bots`;
}

/** Who drives a live one, for the status line. */
function driverOf(item: PageItem): string {
  if (item.driver === "human") return "You drive";
  if (item.profile !== "shared") return `${item.label} drives`;
  return item.bots.length === 1 ? `${item.bots[0]!.name} drives` : "Bots drive";
}

/** The Apps menu: the desktop's applications, loaded when it opens. */
function AppsMenu({
  apps: api,
  profile,
  disabled,
  testId,
}: {
  apps: AppsApi;
  profile: string;
  disabled: boolean;
  testId: string;
}) {
  const [apps, setApps] = useState<DesktopApp[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      setApps((await api.list(profile)).apps);
    } catch (error) {
      setApps([]);
      toast.error(errorMessage(error, "Could not list the apps"));
    }
  };

  const launch = async (app: DesktopApp) => {
    try {
      await api.open(profile, app.id);
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
          data-testid={testId}
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
function KeysMenu({
  shortcuts,
  disabled,
  onSend,
  testId,
}: {
  shortcuts: readonly DesktopShortcut[];
  disabled: boolean;
  onSend: (index: number) => void;
  testId: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={disabled ? "Take control to send keys" : "Send a shortcut to the desktop"}
          data-testid={testId}
        >
          <Keyboard />
          Keys
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Send to the desktop</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {shortcuts.map((shortcut, index) => (
          <DropdownMenuItem key={shortcut.keys} onSelect={() => onSend(index)}>
            <span className="flex-1">{shortcut.label}</span>
            <span className="text-xs text-muted-foreground">{shortcut.keys}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What the view area shows for one that is not live. */
function OffState({
  off,
  kind,
  item,
  onOpen,
}: {
  off: PageOffCopy;
  kind: string;
  item: PageItem;
  onOpen: () => void;
}) {
  if (item.starting) {
    return (
      <EmptyState
        icon={off.icon}
        title={item.phase === "installing" ? off.installing.title : off.starting}
        description={
          item.phase === "installing" ? off.installing.description : "This takes a few seconds."
        }
        action={<LoadingSpinner size="sm" />}
        className="h-full py-6"
      />
    );
  }
  if (item.error) {
    return (
      <ErrorState
        title={off.failed}
        description={
          <span className="mx-auto block max-w-sm break-words" data-testid={`${kind}-page-error`}>
            {item.error}
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
      icon={off.icon}
      title={off.closed.title}
      description={off.closed.description}
      action={
        <Button size="sm" onClick={onOpen} data-testid={`${kind}-page-open`}>
          {off.closed.open}
        </Button>
      }
      className="h-full py-6"
    />
  );
}

export function LivePage<S extends PanelStatus, L, I extends PageItem>({
  surface,
}: {
  surface: LiveSurface<S, L, I>;
}) {
  const { kind, page } = surface;
  const { ticket: fetchTicket, resize: fitWindow } = page.api;
  const [searchParams, setSearchParams] = useSearchParams();
  const linked = page.deepLink ? searchParams.get("profile") : null;
  const [selected, setSelected] = useState(() => linked ?? readSelected(page.selectedKey));

  // A deep link picks the tab, and is remembered like a click.
  useEffect(() => {
    if (!linked) return;
    setSelected(linked);
    storeSelected(page.selectedKey, linked);
  }, [linked, page.selectedKey]);

  // They open, close and change hands from other tabs and from bots. An
  // unknown profile (a deleted bot, a stale link) falls back to Shared.
  const view = useLiveView<L, I>({
    kind,
    source: kind,
    load: () => page.api.list(),
    select: (list) => page.items(list).find((i) => i.profile === selected) ?? page.items(list)[0],
    replace: (list, next) =>
      page.withItems(
        list,
        page.items(list).map((i) => (i.profile === next.profile ? next : i)),
      ),
    starting: (list) => page.items(list).some((i) => i.starting),
    driver: (driver, i) => page.api.driver(i?.profile ?? "shared", driver),
    start: (i) => page.api.start(i?.profile ?? "shared"),
    reset: (i) => page.api.reset(i?.profile ?? "shared"),
    startFailed: page.startFailed,
    resetCopy: (i) => page.resetCopy(i),
  });
  const {
    status: list,
    item,
    streaming,
    humanDrives: driving,
    vncRef,
    vncState,
    setVncState,
    regionRef,
    fullscreen,
    toggleFullscreen,
    setDriver,
    start,
    reset,
    paste,
    refresh,
  } = view;
  const loadError = view.error ? errorMessage(view.error, page.loadFailed.message) : null;
  const items = list ? page.items(list) : [];
  const profile = item?.profile;
  const active = Boolean(item?.active);
  const connection = connectionOf({ mode: streaming ? "vnc" : "headless" }, vncState);

  const select = (next: string) => {
    setSelected(next);
    storeSelected(page.selectedKey, next);
    if (linked) setSearchParams({}, { replace: true });
  };

  const sendShortcut = (index: number) => {
    const shortcut = page.keys?.[index];
    if (!shortcut) return;
    vncRef.current?.sendKeys(shortcut.strokes);
    vncRef.current?.focus();
  };

  // Stable per tab, so the viewer reconnects only on a switch.
  const ticket = useCallback(() => fetchTicket(profile ?? "shared"), [fetchTicket, profile]);
  const resize = useMemo(
    () => fitWindow && ((size: ResizeBody) => fitWindow(profile ?? "shared", size)),
    [fitWindow, profile],
  );

  const body = (() => {
    if (loadError && !list) {
      return (
        <ErrorState
          title={page.loadFailed.title}
          description={loadError}
          action={
            <Button size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        />
      );
    }
    if (!list) return <LoadingState text={page.loading} />;
    if (!page.available(list)) {
      return (
        <EmptyState
          icon={MonitorOff}
          title={page.unavailable.title}
          description={
            <span className="mx-auto block max-w-sm" data-testid={`${kind}-page-setup`}>
              {page.setupHint(list) ?? page.unavailable.hint}
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
        data-testid={`${kind}-region`}
      >
        <div
          role="tablist"
          aria-label={page.tabs.label}
          className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/40 px-1 pt-1"
        >
          {items.map((i) => {
            const isActive = i.profile === profile;
            return (
              <button
                key={i.profile}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => select(i.profile)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-sm",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                data-testid={`${kind}-tab-${i.profile}`}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    i.active
                      ? i.driver === "human"
                        ? "bg-primary"
                        : "bg-success"
                      : i.starting
                        ? "animate-pulse bg-warning"
                        : page.tabs.errorDot && i.error
                          ? "bg-destructive"
                          : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                <span className="font-medium">{i.label}</span>
                <span className="text-xs opacity-60">{usersOf(i, page.tabs.own)}</span>
                {page.takeover && i.takeover && (
                  <Hand className="size-3.5 text-primary" aria-label="Needs you" />
                )}
              </button>
            );
          })}
        </div>

        {page.statusLine && active && item && (
          <div
            className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground"
            data-testid={`${kind}-page-status`}
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", connection.dot)} aria-hidden />
            <span>{connection.label}</span>
            <span aria-hidden>·</span>
            <span>{driverOf(item)}</span>
          </div>
        )}

        {page.takeover && streaming && driving && item?.takeover && (
          <div
            className="flex shrink-0 items-start gap-2 border-b bg-primary/5 px-4 py-2 text-sm"
            data-testid={`${kind}-page-takeover`}
          >
            <Hand className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="font-medium">{page.takeover.asked}</span> {item.takeover}{" "}
              <span className="text-muted-foreground">{page.takeover.note}</span>
            </span>
          </div>
        )}

        <div
          className={cn(
            "relative w-full flex-1 overflow-hidden",
            fullscreen ? "min-h-0" : "h-[60vh] min-h-[320px] md:h-auto md:min-h-0",
          )}
          data-testid={`${kind}-page-viewport`}
        >
          {streaming && profile && (
            <VncView
              key={profile}
              ref={vncRef}
              botId={profile}
              kind={kind}
              ticket={ticket}
              resize={resize}
              interactive={driving}
              onState={setVncState}
            />
          )}
          {streaming && vncState !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {vncState === "connecting" ? page.connecting : "Reconnecting…"}
            </div>
          )}
          {streaming && vncState === "live" && !driving && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <Button
                size="sm"
                className="pointer-events-auto shadow-md"
                onClick={() => void setDriver("human")}
                data-testid={`${kind}-page-takeover-hint`}
              >
                <MousePointerClick />
                View only · Take control to use it
              </Button>
            </div>
          )}
          {page.headless && active && !streaming && (
            <EmptyState
              icon={MonitorOff}
              title={page.headless.title}
              description={page.headless.description}
              className="h-full py-6"
            />
          )}
          {!active && item && (
            <OffState off={page.off} kind={kind} item={item} onOpen={() => void start()} />
          )}
        </div>
      </div>
    );
  })();

  const configured = Boolean(list && page.available(list) && item);

  return (
    <PageLayout
      title={page.title}
      description={page.description}
      maxWidth="full"
      actions={
        configured ? (
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
                    onSend={sendShortcut}
                    testId={`${kind}-keys`}
                  />
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={paste}
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
                  onClick={toggleFullscreen}
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
              onClick={() => void reset()}
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
                  onClick={() => void setDriver("agent")}
                  data-testid={`${kind}-page-release`}
                >
                  <BotIcon />
                  Release control
                </Button>
              ) : (
                <Button onClick={() => void setDriver("human")} data-testid={`${kind}-page-take`}>
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
