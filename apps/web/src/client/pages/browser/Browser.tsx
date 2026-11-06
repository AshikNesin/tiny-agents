/**
 * Browser page (issue #160): the bots' browsers on the sandbox VM, in the
 * app, the way the Computer page gives the owner their desktops. One tab per
 * browser: the shared one (the default, where a site signed into once is
 * signed in for every bot on it), and one per bot with a profile of its own.
 *
 * The view is the chat panel's (`VncView`, kind `browser`), fit to the page,
 * view-only until the owner takes control. The owner works in a tab of their
 * own (`owner` on the server), so opening the page never lands in a bot's
 * tab and handing control back leaves every bot's tab where it was. Taking
 * control is the same driver flag the panel flips, so the bots on that
 * browser wait until it is handed back.
 *
 * `?profile=bot-<id>` opens a given browser (the chat panel links here).
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bot as BotIcon,
  ClipboardPaste,
  Globe,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MonitorOff,
  MousePointerClick,
  RotateCcw,
} from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingSpinner, LoadingState } from "@groot/ui";
import { cn } from "@groot/shell/lib/utils";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import { browserPageApi, type PageBrowser, type PageBrowserList } from "../../lib/browser-page-api";
import { errorMessage } from "../../lib/errors";
import { connectionOf, useLiveView } from "../../lib/live-view";
import { VncView } from "../../components/browser/VncView";

export const BROWSER_SELECTED_KEY = "tiny-agents:browser-page-profile";

function readSelected(): string {
  try {
    return window.localStorage.getItem(BROWSER_SELECTED_KEY) ?? "shared";
  } catch {
    return "shared";
  }
}

function storeSelected(profile: string): void {
  try {
    window.localStorage.setItem(BROWSER_SELECTED_KEY, profile);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/** Who uses a browser, for its tab: "3 bots", "Scout", "no bots yet". */
function usersOf(browser: PageBrowser): string {
  if (browser.profile !== "shared") return "own browser";
  const count = browser.bots.length;
  return count === 0 ? "no bots yet" : count === 1 ? browser.bots[0]!.name : `${count} bots`;
}

/** Who drives a live browser, for the status line. */
function driverOf(browser: PageBrowser): string {
  if (browser.driver === "human") return "You drive";
  if (browser.profile !== "shared") return `${browser.label} drives`;
  return browser.bots.length === 1 ? `${browser.bots[0]!.name} drives` : "Bots drive";
}

/** What the view area shows for a browser that is not live. */
function OffState({ browser, onOpen }: { browser: PageBrowser; onOpen: () => void }) {
  if (browser.starting) {
    return (
      <EmptyState
        icon={Globe}
        title={
          browser.phase === "installing" ? "Installing Chrome on the VM" : "Starting the browser"
        }
        description={
          browser.phase === "installing"
            ? "First run only: installing the browser and its display. This takes a few minutes."
            : "This takes a few seconds."
        }
        action={<LoadingSpinner size="sm" />}
        className="h-full py-6"
      />
    );
  }
  if (browser.error) {
    return (
      <ErrorState
        title="Couldn't start the browser"
        description={
          <span className="mx-auto block max-w-sm break-words" data-testid="browser-page-error">
            {browser.error}
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
      icon={Globe}
      title="This browser is closed."
      description="It also opens when a bot that uses it browses."
      action={
        <Button size="sm" onClick={onOpen} data-testid="browser-page-open">
          Open browser
        </Button>
      }
      className="h-full py-6"
    />
  );
}

export function BrowserPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState(() => searchParams.get("profile") ?? readSelected());

  // A deep link picks the browser, and is remembered like a click.
  const linked = searchParams.get("profile");
  useEffect(() => {
    if (!linked) return;
    setSelected(linked);
    storeSelected(linked);
  }, [linked]);

  // An unknown profile (a deleted bot, a stale link) falls back to Shared.
  const pick = (list: PageBrowserList) =>
    list.browsers.find((b) => b.profile === selected) ?? list.browsers[0];

  // Browsers open, close and change hands from other tabs and from bots.
  const view = useLiveView<PageBrowserList, PageBrowser>({
    kind: "browser",
    source: "browsers",
    load: () => browserPageApi.list(),
    select: pick,
    replace: (list, next) => ({
      ...list,
      browsers: list.browsers.map((b) => (b.profile === next.profile ? next : b)),
    }),
    starting: (list) => list.browsers.some((b) => b.starting),
    driver: (driver, b) => browserPageApi.driver(b?.profile ?? "shared", driver),
    start: (b) => browserPageApi.start(b?.profile ?? "shared"),
    reset: (b) => browserPageApi.reset(b?.profile ?? "shared"),
    startFailed: "Failed to open the browser",
    resetCopy: (b) => {
      const others = b?.bots.map((bot) => bot.name) ?? [];
      return {
        confirm: {
          title: `Reset the ${b?.label ?? "Shared"} browser?`,
          description:
            "This closes the browser and deletes its profile: cookies, logins and history" +
            (b?.profile === "shared" && others.length > 0
              ? `. Every bot on it is signed out (${others.join(", ")}).`
              : "."),
          confirmLabel: "Reset",
          destructive: true,
        },
        done: "Browser reset; it starts fresh next time.",
      };
    },
  });
  const {
    status: list,
    item: browser,
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
  const loadError = view.error ? errorMessage(view.error, "Failed to load the browsers") : null;
  const browsers = list?.browsers ?? [];
  const profile = browser?.profile;
  const live = Boolean(browser?.active);
  const connection = connectionOf({ mode: streaming ? "vnc" : "headless" }, vncState);

  const select = (next: string) => {
    setSelected(next);
    storeSelected(next);
    if (linked) setSearchParams({}, { replace: true });
  };

  // Stable per browser, so the viewer reconnects only on a switch.
  const ticket = useCallback(() => browserPageApi.ticket(profile ?? "shared"), [profile]);
  const resize = useCallback(
    (size: { width: number; height: number }) => browserPageApi.resize(profile ?? "shared", size),
    [profile],
  );

  const body = (() => {
    if (loadError && !list) {
      return (
        <ErrorState
          title="Couldn't load the browsers"
          description={loadError}
          action={
            <Button size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          }
        />
      );
    }
    if (!list) return <LoadingState text="Loading browsers…" />;
    if (!list.liveView) {
      return (
        <EmptyState
          icon={MonitorOff}
          title="No live browser on this server"
          description={
            <span className="mx-auto block max-w-sm" data-testid="browser-page-setup">
              {list.setupHint ?? "The browser runs headless here."}
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
        data-testid="browser-region"
      >
        <div
          role="tablist"
          aria-label="Browsers"
          className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/40 px-1 pt-1"
        >
          {browsers.map((b) => {
            const isActive = b.profile === profile;
            return (
              <button
                key={b.profile}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => select(b.profile)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-1.5 text-sm",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                data-testid={`browser-tab-${b.profile}`}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    b.active
                      ? b.driver === "human"
                        ? "bg-primary"
                        : "bg-success"
                      : b.starting
                        ? "animate-pulse bg-warning"
                        : b.error
                          ? "bg-destructive"
                          : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                <span className="font-medium">{b.label}</span>
                <span className="text-xs opacity-60">{usersOf(b)}</span>
              </button>
            );
          })}
        </div>

        {live && browser && (
          <div
            className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground"
            data-testid="browser-page-status"
          >
            <span className={cn("size-1.5 shrink-0 rounded-full", connection.dot)} aria-hidden />
            <span>{connection.label}</span>
            <span aria-hidden>·</span>
            <span>{driverOf(browser)}</span>
          </div>
        )}

        <div
          className={cn(
            "relative w-full flex-1 overflow-hidden",
            fullscreen ? "min-h-0" : "h-[60vh] min-h-[320px] md:h-auto md:min-h-0",
          )}
          data-testid="browser-page-viewport"
        >
          {streaming && profile && (
            <VncView
              key={profile}
              ref={vncRef}
              botId={profile}
              kind="browser"
              ticket={ticket}
              resize={resize}
              interactive={driving}
              onState={setVncState}
            />
          )}
          {streaming && vncState !== "live" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {vncState === "connecting" ? "Connecting to the browser…" : "Reconnecting…"}
            </div>
          )}
          {streaming && vncState === "live" && !driving && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <Button
                size="sm"
                className="pointer-events-auto shadow-md"
                onClick={() => void setDriver("human")}
                data-testid="browser-page-takeover-hint"
              >
                <MousePointerClick />
                View only · Take control to use it
              </Button>
            </div>
          )}
          {live && !streaming && (
            <EmptyState
              icon={MonitorOff}
              title="This browser is headless"
              description="Bots can use it, but it has no display to show."
              className="h-full py-6"
            />
          )}
          {!live && browser && <OffState browser={browser} onOpen={() => void start()} />}
        </div>
      </div>
    );
  })();

  const configured = Boolean(list?.liveView && browser);

  return (
    <PageLayout
      title="Browser"
      description="The bots' browsers on the sandbox VM. Take control to use one yourself; bots on it wait."
      maxWidth="full"
      actions={
        configured ? (
          <>
            {streaming && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={paste}
                  disabled={!driving}
                  aria-label="Paste from your clipboard"
                  title="Paste from your clipboard"
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="browser-page-paste"
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
                  data-testid="browser-page-fullscreen"
                >
                  {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void reset()}
              aria-label="Reset browser"
              title="Close this browser and wipe its profile"
              className="text-muted-foreground hover:text-foreground"
              data-testid="browser-page-reset"
            >
              <RotateCcw className="size-4" />
            </Button>
            {streaming &&
              (driving ? (
                <Button
                  variant="secondary"
                  onClick={() => void setDriver("agent")}
                  data-testid="browser-page-release"
                >
                  <BotIcon />
                  Release control
                </Button>
              ) : (
                <Button onClick={() => void setDriver("human")} data-testid="browser-page-take">
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
