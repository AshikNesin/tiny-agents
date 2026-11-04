/**
 * One xterm.js terminal wired to its tab's pty socket (issue #28). The page
 * keeps every session's view mounted and hides the inactive ones, so this
 * component owns a terminal for its whole session lifetime: scrollback, the
 * pty stream and the socket all stay warm across tab switches.
 *
 * Clipboard and keys live in `lib/xterm.ts`; this component adds the
 * right-click menu (Copy / Paste / Select all), the connection overlays and
 * the size badge shown while the grid changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, Copy, RotateCcw, TextSelect } from "lucide-react";
import { Button } from "@groot/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { useTheme } from "@groot/shell/lib/theme";
import {
  connectTerminal,
  type TerminalConnection,
  type TerminalConnectionState,
} from "../../lib/terminal-ws";
import { createTerminal, type TerminalHandle, type TerminalSize } from "../../lib/xterm";
import { isMac, pasteShortcut, readClipboardText } from "../../lib/clipboard";

/** What the page's keys panel needs from a live view. */
export interface TerminalControls {
  /** Keystrokes as pty bytes; a no-op until the socket is open. */
  send: (bytes: Uint8Array<ArrayBuffer>) => void;
  /** Text as a paste (bracketed), e.g. from the clipboard button. */
  paste: (text: string) => void;
  /** Put the caret back in the terminal (after a panel key press). */
  focus: () => void;
}

export interface TerminalViewProps {
  name: string;
  active: boolean;
  /** Font size in px; changing it refits the grid. */
  fontSize: number;
  /** Ctrl/Cmd + = / - / 0 pressed inside the terminal. */
  onFontSizeKey?: (step: 1 | -1 | 0) => void;
  /** Connection state, bubbled to the tab strip's status dot. */
  onState: (state: TerminalConnectionState) => void;
  /** Grid changes, bubbled so "New tab" can open at the current size. */
  onResize?: (size: TerminalSize) => void;
  /** Grid before the first fit, so a new tab opens at the size it becomes. */
  initialSize?: TerminalSize;
  /** Live controls, registered on connect and unregistered on dispose. */
  onControls?: (controls: TerminalControls | null) => void;
}

/** Same debounce as VncView's resize path. */
const RESIZE_DEBOUNCE_MS = 150;
/** How long the cols×rows badge stays after the last resize. */
const SIZE_BADGE_MS = 900;

const ENCODER = new TextEncoder();

/** Paste whatever the clipboard holds, or tell the owner which chord works. */
export async function pasteFromClipboard(paste: (text: string) => void): Promise<void> {
  const result = await readClipboardText();
  if (result.ok) {
    if (result.text) paste(result.text);
    return;
  }
  toast.info(`Press ${pasteShortcut()} to paste`, {
    description:
      result.reason === "unavailable"
        ? "This page can't read the clipboard directly (it isn't served over https)."
        : "The browser blocked clipboard access for this page.",
  });
}

export function TerminalView({
  name,
  active,
  fontSize,
  onFontSizeKey,
  onState,
  onResize,
  initialSize,
  onControls,
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const connectionRef = useRef<TerminalConnection | null>(null);
  const onStateRef = useRef(onState);
  const onResizeRef = useRef(onResize);
  const onControlsRef = useRef(onControls);
  const onFontSizeKeyRef = useRef(onFontSizeKey);
  const fontSizeRef = useRef(fontSize);
  const fitRef = useRef<() => void>(() => undefined);
  const [connection, setConnection] = useState<TerminalConnectionState>("connecting");
  // True until the first pty bytes land: the pane is blank until then.
  const [waiting, setWaiting] = useState(true);
  const [sizeBadge, setSizeBadge] = useState<TerminalSize | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null);
  // Bumped by "Reconnect" on the ended overlay: a fresh terminal + attach.
  const [attempt, setAttempt] = useState(0);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    onStateRef.current = onState;
    onResizeRef.current = onResize;
    onControlsRef.current = onControls;
    onFontSizeKeyRef.current = onFontSizeKey;
  }, [onState, onResize, onControls, onFontSizeKey]);

  // Create + attach is a one-shot per session: the effect keys only on
  // `name`, and the cleanup disposes exactly once even under StrictMode's
  // mount/unmount/remount (VncView's cancelled-flag pattern).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let unsubscribeData: (() => void) | undefined;
    let unsubscribeResize: (() => void) | undefined;
    let size: TerminalSize | null = initialSize ?? null;
    let badgeTimer: ReturnType<typeof setTimeout> | undefined;

    const start = async () => {
      const terminal = await createTerminal(host, {
        ...initialSize,
        fontSize: fontSizeRef.current,
        onCopy: (_text, ok) => {
          if (ok) toast.success("Copied to clipboard", { id: "terminal-copy", duration: 1200 });
          else toast.error("The browser blocked the copy", { id: "terminal-copy" });
        },
        onFontSizeKey: (step) => onFontSizeKeyRef.current?.(step),
      });
      if (disposed) {
        terminal.dispose();
        return;
      }
      terminalRef.current = terminal;

      // Keystrokes go out as pty bytes; pty bytes coming back get written.
      unsubscribeData = terminal.onData((data) => {
        connectionRef.current?.sendInput(ENCODER.encode(data));
      });
      // The single resize path: fit() changes the grid, onResize reports it.
      unsubscribeResize = terminal.onResize((next) => {
        size = next;
        onResizeRef.current?.(next);
        connectionRef.current?.sendResize(next.cols, next.rows);
        setSizeBadge(next);
        clearTimeout(badgeTimer);
        badgeTimer = setTimeout(() => setSizeBadge(null), SIZE_BADGE_MS);
      });

      // Measure before connecting so the attach URL carries the real grid.
      fitRef.current();
      size = terminal.proposeDimensions() ?? size;

      let wasLive = false;
      connectionRef.current = connectTerminal(name, {
        size: () => size,
        onData: (bytes) => {
          setWaiting(false);
          const count = bytes.byteLength;
          terminal.write(bytes, () => connectionRef.current?.written(count));
        },
        onStateChange: (state) => {
          if (state === "live") {
            // A re-attach redraws the whole screen; clear what the old
            // attach left behind (mouse/paste modes, alt screen, colours)
            // so none of it bleeds into the new picture.
            if (wasLive) terminal.reset();
            wasLive = true;
            // The URL carried the size, but the box may have changed while
            // the socket was opening: always confirm the grid once live.
            if (size) connectionRef.current?.sendResize(size.cols, size.rows);
          }
          // A retry has its own chip, and a closed tab has nothing coming.
          if (state === "reconnecting" || state === "closed") setWaiting(false);
          setConnection(state);
          onStateRef.current(state);
        },
      });

      // The page keeps one registry entry per tab so its keys panel can
      // write into whichever view is active.
      onControlsRef.current?.({
        send: (bytes) => connectionRef.current?.sendInput(bytes),
        paste: (text) => terminalRef.current?.paste(text),
        focus: () => terminalRef.current?.focus(),
      });
    };
    void start();

    return () => {
      disposed = true;
      clearTimeout(badgeTimer);
      unsubscribeData?.();
      unsubscribeResize?.();
      connectionRef.current?.close();
      connectionRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      onControlsRef.current?.(null);
    };
    // initialSize is the pre-fit grid only; a view is mounted per session
    // with one stable value, so it is intentionally not a dependency.
  }, [name, attempt]);

  // Follow the app theme; xterm.ts re-reads the CSS tokens on every call.
  useEffect(() => {
    terminalRef.current?.setTheme(resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
    terminalRef.current?.setFontSize(fontSize);
  }, [fontSize]);

  // Activation: refit (the box went display:none -> laid out) and focus.
  useEffect(() => {
    if (!active) return;
    fitRef.current();
    terminalRef.current?.focus();
  }, [active]);

  // Fit follows the box. The ResizeObserver + 150ms debounce collapses a
  // burst of box changes into the last one (VncView's pattern); a fit that
  // arrives before the terminal exists is held and run once at creation.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fit = () => {
      // fit() is a no-op while hidden or unchanged; a real change reaches
      // the server through onResize, the one resize path.
      terminalRef.current?.fit();
    };
    fitRef.current = fit;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => fit(), RESIZE_DEBOUNCE_MS);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      fitRef.current = () => undefined;
    };
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);
  const mac = isMac();

  return (
    <div
      className={active ? "relative h-full w-full overflow-hidden" : "relative hidden"}
      data-testid={`terminal-view-${name}`}
    >
      {/* The xterm host. Its padding is subtracted by the fit addon, so the
          grid never touches the frame's edge. */}
      <div
        ref={hostRef}
        className="h-full w-full overflow-hidden px-2 pt-1.5 pb-1"
        onMouseDown={() => terminalRef.current?.focus()}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({
            x: event.clientX,
            y: event.clientY,
            canCopy: terminalRef.current?.hasSelection() ?? false,
          });
        }}
      />

      <DropdownMenu open={menu !== null} onOpenChange={(open) => !open && closeMenu()}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed size-0"
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56"
          onCloseAutoFocus={(event) => {
            // Back to the terminal, not to the invisible anchor.
            event.preventDefault();
            terminalRef.current?.focus();
          }}
          data-testid={`terminal-menu-${name}`}
        >
          <DropdownMenuItem
            disabled={!menu?.canCopy}
            onSelect={() => void terminalRef.current?.copySelection()}
          >
            <Copy />
            Copy
            <DropdownMenuShortcut>{mac ? "⌘C" : "Ctrl+Shift+C"}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void pasteFromClipboard((text) => {
                terminalRef.current?.paste(text);
              })
            }
          >
            <ClipboardPaste />
            Paste
            <DropdownMenuShortcut>{pasteShortcut()}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => terminalRef.current?.selectAll()}>
            <TextSelect />
            Select all
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Drag to copy. Hold {mac ? "⌥" : "Shift"} to select without tmux.
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>

      {waiting && connection !== "closed" && (
        <span
          className="text-muted-foreground pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm"
          aria-live="polite"
          data-testid={`terminal-connecting-${name}`}
        >
          <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
          Connecting to sandbox…
        </span>
      )}
      {connection === "reconnecting" && (
        <span
          className="bg-background/90 text-muted-foreground pointer-events-none absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1 text-xs ring-1 ring-border"
          aria-live="polite"
          data-testid={`terminal-reconnecting-${name}`}
        >
          <span className="size-1.5 animate-pulse rounded-full bg-warning" />
          Connection lost. Reconnecting…
        </span>
      )}
      {connection === "closed" && (
        // The attach ended: the session was killed (the tab leaves the list
        // on the next poll) or this client was detached (Ctrl+B d), in which
        // case the session is still there and Reconnect picks it back up.
        <div
          className="bg-background/80 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
          aria-live="polite"
          data-testid={`terminal-ended-${name}`}
        >
          Disconnected from this tab.
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setWaiting(true);
              setConnection("connecting");
              setAttempt((n) => n + 1);
            }}
            data-testid={`terminal-reconnect-${name}`}
          >
            <RotateCcw />
            Reconnect
          </Button>
        </div>
      )}
      {sizeBadge && active && (
        <span
          className="bg-background/90 pointer-events-none absolute right-3 bottom-3 z-10 rounded-md px-2 py-0.5 font-mono text-xs text-muted-foreground tabular-nums ring-1 ring-border"
          data-testid={`terminal-size-${name}`}
        >
          {sizeBadge.cols}×{sizeBadge.rows}
        </span>
      )}
    </div>
  );
}
