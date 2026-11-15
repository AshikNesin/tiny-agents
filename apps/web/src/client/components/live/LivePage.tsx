/**
 * The live-view page: the bots' browsers (issue #160) or desktops on the
 * sandbox VM, in the app, for the surface it is given (`surface.ts`). One
 * tab per browser or desktop: the shared one (the default, where a site
 * signed into once is signed in for every bot on it), and one per bot with a
 * profile of its own.
 *
 * The view is the chat panel's (`VncView`), fit to the page (the browser's
 * window) or scaled to it (the desktop's fixed size), view-only until the
 * owner clicks it to take control. One bar over it holds the tabs, a status
 * chip and the tools, so full screen (the view and its bar) keeps them all.
 * Taking control is the same driver flag the panel flips, so the bots on that browser or desktop wait (and take no
 * screenshots) until it is handed back, and a bot's takeover request is
 * answered by the hand-back here too. The browser's owner works in a tab of
 * their own (`owner` on the server), so opening the page never lands in a
 * bot's tab. While driving a desktop, the owner can open apps and send the
 * shortcuts the local browser would keep for itself (Alt+Tab, Alt+F4,
 * Ctrl+W).
 */
import { useCallback, useMemo } from "react";
import { MonitorOff } from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import type { ResizeBody } from "../../../shared/api/live";
import { errorMessage } from "../../lib/errors";
import { connectionOf, useLiveView } from "../../lib/live-view";
import { VncView } from "../browser/VncView";
import {
  ConnectingOverlay,
  DrivingFrame,
  StatusChip,
  TakeControlLayer,
  TakeoverBanner,
} from "./live-parts";
import { LivePageActions } from "./LivePageActions";
import { OffState } from "./LivePageOffState";
import { driverOf, LivePageTabs } from "./LivePageTabs";
import type { LiveSurface, PageItem, PanelStatus } from "./surface";
import { useSelectedProfile } from "./use-selected-profile";

export function LivePage<S extends PanelStatus, L, I extends PageItem>({
  surface,
}: {
  surface: LiveSurface<S, L, I>;
}) {
  const { kind, page } = surface;
  const { ticket: fetchTicket, resize: fitWindow } = page.api;
  const { selected, select } = useSelectedProfile(page.selectedKey, page.deepLink);

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
  const live = streaming && vncState === "live";

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
        {/* One bar: the tabs, the selected one's status, its tools. A container:
            a narrow one (a phone) puts the tabs on a row of their own. */}
        <div className="@container flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-1.5 py-1">
          <LivePageTabs kind={kind} page={page} items={items} profile={profile} onSelect={select} />
          {active && item && (
            <StatusChip
              connection={connection}
              live={live}
              yours={driving}
              driver={driverOf(item)}
              testId={`${kind}-page-status`}
              driverTestId={`${kind}-page-driver`}
            />
          )}
          {item && (
            <LivePageActions
              kind={kind}
              page={page}
              profile={profile}
              streaming={streaming}
              driving={driving}
              fullscreen={fullscreen}
              onSendShortcut={sendShortcut}
              onPaste={paste}
              onToggleFullscreen={toggleFullscreen}
              onReset={() => void reset()}
              onDriver={(driver) => void setDriver(driver)}
            />
          )}
        </div>

        {page.takeover && streaming && driving && item?.takeover && (
          <TakeoverBanner
            testId={`${kind}-page-takeover`}
            asked={page.takeover.asked}
            reason={item.takeover}
            note={page.takeover.note}
          />
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
            <ConnectingOverlay vncState={vncState} connecting={page.connecting} />
          )}
          {live && !driving && (
            <TakeControlLayer
              testId={`${kind}-page-take`}
              title={page.takeTitle}
              onTake={() => void setDriver("human")}
            />
          )}
          {live && driving && <DrivingFrame testId={`${kind}-page-driving-frame`} />}
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

  return (
    <PageLayout title={page.title} description={page.description} maxWidth="full">
      {body}
    </PageLayout>
  );
}
