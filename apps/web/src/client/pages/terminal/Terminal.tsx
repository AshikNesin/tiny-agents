/**
 * Terminal page (issue #28): real shells on the sandbox VM, in tabs, inside
 * the app. A tab IS a tmux session on the VM, so the list is read from the
 * VM and polled every 5s; tabs opened from another device appear on their
 * own, and tabs survive the browser, the app process and the device.
 *
 * Mounting policy: one TerminalView per session, mounted the whole time the
 * session is listed, inactive ones hidden with display:none and re-fitted on
 * activation. xterm.js is happy rendering into a display:none host (it just
 * has no measurable box until shown), so scrollback, the pty stream and the
 * ticketed socket all stay warm across tab switches, switching back is a
 * local repaint, not a reconnect, and output landing on a background tab is
 * already in its buffer when the owner returns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Keyboard,
  Maximize2,
  Minimize2,
  MonitorOff,
  PackageOpen,
  Minus,
  Plus,
  SquareTerminal,
  X,
} from "lucide-react";
import { Button, EmptyState, ErrorState, LoadingState, monoClass } from "@groot/ui";
import { cn } from "@groot/shell/lib/utils";
import { useConfirm } from "@groot/ui/primitives";
import { PageLayout } from "@groot/shell/components/layout/PageLayout";
import {
  terminalApi,
  closeBlockedReason,
  type TerminalSession,
  type TerminalStatusWire,
} from "../../lib/terminal-api";
import type { TerminalConnectionState } from "../../lib/terminal-ws";
import { TerminalView, type TerminalControls } from "./TerminalView";
import { TerminalKeysPanel } from "./TerminalKeysPanel";
import { errorMessage } from "../../lib/errors";
import { DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from "../../lib/xterm";
import { isMac } from "../../lib/clipboard";
import { useFullScreen } from "../../lib/live-view";

/** The modifier the terminal's font chords use on this platform. */
const MOD = isMac() ? "⌘" : "Ctrl";

/** GET /terminal/sessions answers { status, sessions } (frozen contract). */

type TabStatus = Record<string, TerminalConnectionState>;

/** The strip shows a dot while a tab's socket is still establishing itself. */
const CONNECTING: ReadonlySet<TerminalConnectionState> = new Set(["connecting", "reconnecting"]);

/** `ta-term-3` -> "3": the prefix is ours, the number is the whole signal. */
function tabLabel(name: string): string {
  return name.replace(/^ta-term-/, "");
}

/** Below md the panel would cover most of a phone's terminal, so a first
 * visit starts it collapsed there and open everywhere else. */
const KEYS_KEY = "tiny-agents:terminal-keys";

function readKeysOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(KEYS_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    /* storage unavailable: fall through to the viewport default */
  }
  return !window.matchMedia?.("(max-width: 767px)").matches;
}

function storeKeysOpen(open: boolean): void {
  try {
    window.localStorage.setItem(KEYS_KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

const FONT_KEY = "tiny-agents:terminal-font-size";

function readFontSize(): number {
  try {
    const stored = Number(window.localStorage.getItem(FONT_KEY));
    if (stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE) return stored;
  } catch {
    /* storage unavailable: the default */
  }
  return DEFAULT_FONT_SIZE;
}

function storeFontSize(px: number): void {
  try {
    window.localStorage.setItem(FONT_KEY, String(px));
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/** In full screen Escape goes to the shell (vim, less) instead of leaving it. */
const LOCKED_KEYS = ["Escape"];

export function TerminalPage() {
  const [sessions, setSessions] = useState<TerminalSession[] | null>(null);
  const [status, setStatus] = useState<TerminalStatusWire | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // `?tab=` opens on that tab (Settings → Claude plan → Sign in links here).
  const [searchParams] = useSearchParams();
  const [active, setActive] = useState<string | null>(() => searchParams.get("tab"));
  const [tabStatus, setTabStatus] = useState<TabStatus>({});
  const [creating, setCreating] = useState(false);
  const [keysOpen, setKeysOpen] = useState(readKeysOpen);
  const [fontSize, setFontSize] = useState(readFontSize);
  const confirm = useConfirm();
  const regionRef = useRef<HTMLDivElement>(null);
  // Full screen is the CSS state (fixed inset-0), so it works where the
  // Fullscreen API doesn't (iOS Safari never fullscreens a div). The API is
  // best-effort chrome-hiding; when it does work, its events stay in sync.
  const { fullscreen, toggleFullscreen } = useFullScreen(regionRef, LOCKED_KEYS, {
    fallback: "css",
  });

  // Live views by tab name: the keys panel writes into the active one. A ref,
  // not state, registrations happen on socket lifecycles that don't render.
  const controlsRef = useRef(new Map<string, TerminalControls>());

  // The current grid, for "New tab" (a tab opens at the size the owner sees).
  // Ref, not state: it changes on every resize without deserving a re-render.
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await terminalApi.list();
      setStatus(list.status);
      setSessions(list.sessions);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Failed to load terminal tabs"));
    }
  }, []);

  // Poll the VM (tabs change from any device) and refetch on window focus.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const names = useMemo(() => (sessions ?? []).map((s) => s.name), [sessions]);

  // The active tab must exist: one closed elsewhere falls forward to the
  // first remaining tab; none left shows the ready empty state.
  useEffect(() => {
    if (sessions === null) return; // not loaded yet: keep a requested tab
    if (names.length === 0) {
      setActive((current) => (current === null ? current : null));
      return;
    }
    if (!active || !names.includes(active)) setActive(names[0]!);
  }, [sessions, names, active]);

  // Prune statuses of tabs that left the list.
  useEffect(() => {
    const listed = new Set(names);
    setTabStatus((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([name]) => listed.has(name)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [names]);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await terminalApi.create(sizeRef.current ?? undefined);
      await refresh();
      setActive(created.name);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to open a new tab"));
    } finally {
      setCreating(false);
    }
  }, [creating, refresh]);

  const removeTab = useCallback(
    async (name: string, force = false) => {
      try {
        await terminalApi.remove(name, force);
        setSessions((prev) => (prev ? prev.filter((s) => s.name !== name) : prev));
      } catch (error) {
        const blocked = closeBlockedReason(error);
        if (blocked) {
          const running = blocked.process ?? "a process";
          const confirmed = await confirm({
            title: `${running} is running in this tab`,
            description: `Force-closing tab ${tabLabel(name)} kills it. Its history is lost with it.`,
            confirmLabel: "Force close",
            destructive: true,
          });
          if (confirmed) void removeTab(name, true);
          return;
        }
        toast.error(errorMessage(error, "Failed to close the tab"));
      }
    },
    [confirm],
  );

  const onState = useCallback((name: string, state: TerminalConnectionState) => {
    setTabStatus((prev) => (prev[name] === state ? prev : { ...prev, [name]: state }));
  }, []);

  // One size for every tab: switching tabs never changes the text size.
  const stepFont = useCallback((step: 1 | -1 | 0) => {
    setFontSize((current) => {
      const next =
        step === 0
          ? DEFAULT_FONT_SIZE
          : Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current + step));
      storeFontSize(next);
      return next;
    });
  }, []);

  const toggleKeys = () => {
    setKeysOpen((open) => {
      storeKeysOpen(!open);
      return !open;
    });
  };

  const body = (() => {
    if (loadError && sessions === null) {
      return (
        <ErrorState
          title="Couldn't load the terminal"
          description={loadError}
          action={
            <Button size="sm" onClick={() => void refresh()} data-testid="terminal-retry">
              Retry
            </Button>
          }
        />
      );
    }
    if (status?.kind === "unconfigured") {
      return (
        <EmptyState
          icon={MonitorOff}
          title="Sandbox not configured"
          description={
            <span>
              The terminal runs on the sandbox VM. Set{" "}
              <span className={monoClass}>SANDBOX_HOST</span> on the server to point at it.
            </span>
          }
        />
      );
    }
    if (status?.kind === "tmux-missing") {
      return (
        <EmptyState
          icon={PackageOpen}
          title="tmux is not installed on the sandbox"
          description={
            <span>
              Install it on the VM:{" "}
              <code className={monoClass}>
                {status.installCommand ?? "sudo apt-get install -y tmux"}
              </code>
            </span>
          }
        />
      );
    }
    if (status?.kind === "unreachable") {
      return (
        <ErrorState
          title="Sandbox unreachable"
          description={status.message ?? "The sandbox VM did not answer."}
          action={
            <Button size="sm" onClick={() => void refresh()} data-testid="terminal-retry">
              Retry
            </Button>
          }
        />
      );
    }
    // The first list is an SSH round trip to the VM; until it answers there
    // is nothing to say "No tabs" about.
    if (sessions === null) return <LoadingState text="Connecting to sandbox…" />;
    if (sessions.length === 0) {
      return (
        <EmptyState
          icon={SquareTerminal}
          title="No tabs open"
          description="A tab is a shell on the sandbox VM. It keeps running when you close the app."
          action={
            <Button size="sm" onClick={() => void create()}>
              Open your first tab
            </Button>
          }
        />
      );
    }
    return (
      <div
        ref={regionRef}
        className={cn(
          "flex flex-col overflow-hidden rounded-xl bg-background ring-1 ring-border",
          fullscreen ? "fixed inset-0 z-40 rounded-none p-2 ring-0" : "md:h-[calc(100dvh-15rem)]",
        )}
        data-testid="terminal-region"
      >
        <div
          role="tablist"
          aria-label="Terminal tabs"
          className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-muted/40 px-1 pt-1"
        >
          {sessions.map((session) => {
            const isActive = session.name === active;
            const state = tabStatus[session.name] ?? "connecting";
            const connecting = CONNECTING.has(state);
            const command = session.process;
            return (
              <div
                key={session.name}
                className={cn(
                  "group flex shrink-0 items-center gap-1 rounded-t-lg py-1.5 pr-1 pl-2.5 text-sm",
                  isActive
                    ? "bg-background text-foreground ring-1 ring-border [clip-path:inset(-1px_-1px_0_-1px)]"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActive(session.name)}
                  className="flex items-center gap-1.5"
                  data-testid={`terminal-tab-${session.name}`}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      connecting
                        ? "animate-pulse bg-warning"
                        : state === "live"
                          ? "bg-success"
                          : "bg-muted-foreground/50",
                    )}
                    title={connecting ? "Connecting" : state === "live" ? "Connected" : "Ended"}
                    data-testid={`terminal-tab-status-${session.name}`}
                    data-state={state}
                  />
                  <span className="font-medium">{tabLabel(session.name)}</span>
                  {command && <span className="text-xs opacity-60">{command}</span>}
                </button>
                <button
                  type="button"
                  onClick={() => void removeTab(session.name)}
                  aria-label={`Close tab ${tabLabel(session.name)}`}
                  className="rounded p-0.5 text-muted-foreground opacity-60 group-hover:opacity-100 hover:bg-muted hover:text-foreground"
                  data-testid={`terminal-close-${session.name}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void create()}
            aria-label="New tab"
            className="my-1 shrink-0 self-center"
            data-testid="terminal-new-tab"
          >
            <Plus />
          </Button>
          {/* Inside the region, so it stays reachable in the CSS full screen that
              covers the page header (no Fullscreen API on iOS Safari, #170). */}
          {fullscreen && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleFullscreen}
              aria-label="Exit full screen"
              title="Exit full screen"
              className="my-1 ml-auto shrink-0 self-center text-muted-foreground hover:text-foreground"
              data-testid="terminal-exit-fullscreen"
            >
              <Minimize2 className="size-4" />
            </Button>
          )}
        </div>
        {/* The terminal row: the view column and the keys panel. Below md
            the panel overlays the terminal (it is positioned against this
            row), at md+ it docks beside it, and since the terminal keeps
            its column either way, its box only changes on the md crossing. */}
        <div className="relative flex min-h-0 flex-1">
          {/* min-w-0 + overflow-hidden: the column takes its width from the
              row, never from xterm's canvas. Without them a bigger font
              widened the column, which refit the grid, which widened it
              again, and the keys panel got squeezed. */}
          <div className="h-[60vh] min-h-[320px] min-w-0 flex-1 overflow-hidden md:h-full md:min-h-0">
            {sessions.map((session) => (
              <TerminalView
                key={session.name}
                name={session.name}
                active={session.name === active}
                fontSize={fontSize}
                onFontSizeKey={stepFont}
                onState={(state) => onState(session.name, state)}
                onResize={(size) => {
                  sizeRef.current = size;
                }}
                initialSize={sizeRef.current ?? undefined}
                onControls={(controls) => {
                  const registry = controlsRef.current;
                  if (controls) registry.set(session.name, controls);
                  else registry.delete(session.name);
                }}
              />
            ))}
          </div>
          {active && keysOpen && (
            <TerminalKeysPanel
              getControls={() => controlsRef.current.get(active ?? "")}
              onCollapse={() => {
                setKeysOpen(false);
                storeKeysOpen(false);
              }}
            />
          )}
        </div>
      </div>
    );
  })();

  const sandboxDown = status?.kind === "unreachable" || status?.kind === "tmux-missing";

  return (
    <PageLayout
      title="Terminal"
      description="Shells on the sandbox VM. Tabs keep running when you leave."
      maxWidth="full"
      actions={
        // Nothing to act on while the sandbox is down or tmux is missing.
        sandboxDown ? undefined : (
          <>
            {active && (
              <>
                <div
                  className="flex items-center rounded-lg ring-1 ring-border"
                  role="group"
                  aria-label="Font size"
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => stepFont(-1)}
                    disabled={fontSize <= MIN_FONT_SIZE}
                    aria-label="Smaller text"
                    title={`Smaller text (${MOD} −)`}
                    className="text-muted-foreground hover:text-foreground"
                    data-testid="terminal-font-down"
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <button
                    type="button"
                    onClick={() => stepFont(0)}
                    title={`Reset text size (${MOD} 0)`}
                    className="min-w-7 text-center font-mono text-xs text-muted-foreground tabular-nums hover:text-foreground"
                    data-testid="terminal-font-size"
                  >
                    {fontSize}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => stepFont(1)}
                    disabled={fontSize >= MAX_FONT_SIZE}
                    aria-label="Larger text"
                    title={`Larger text (${MOD} +)`}
                    className="text-muted-foreground hover:text-foreground"
                    data-testid="terminal-font-up"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={keysOpen}
                  aria-label={keysOpen ? "Hide keys panel" : "Show keys panel"}
                  title={keysOpen ? "Hide keys panel" : "Show keys panel"}
                  onClick={toggleKeys}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="terminal-keys-toggle"
                >
                  <Keyboard className="size-4" />
                </Button>
                {/* Enter only: in full screen the region covers this header, so the
                    exit control lives inside the region (#170). */}
                {!fullscreen && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={toggleFullscreen}
                    aria-label="Full screen"
                    title="Full screen"
                    className="text-muted-foreground hover:text-foreground"
                    data-testid="terminal-fullscreen"
                  >
                    <Maximize2 className="size-4" />
                  </Button>
                )}
              </>
            )}
            <Button onClick={() => void create()} disabled={creating} data-testid="terminal-create">
              <Plus />
              New tab
            </Button>
          </>
        )
      }
    >
      {body}
    </PageLayout>
  );
}
