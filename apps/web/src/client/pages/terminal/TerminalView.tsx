/**
 * One xterm.js terminal wired to its tab's pty socket (issue #28). The page
 * keeps every session's view mounted and hides the inactive ones, so this
 * component owns a terminal for its whole session lifetime: scrollback, the
 * pty stream and the socket all stay warm across tab switches.
 */
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@groot/shell/lib/theme";
import {
  connectTerminal,
  type TerminalConnection,
  type TerminalConnectionState,
} from "../../lib/terminal-ws";
import { createTerminal, type TerminalHandle, type TerminalSize } from "../../lib/xterm";

/** What the page's keys panel needs from a live view. */
export interface TerminalControls {
  /** Keystrokes as pty bytes; a no-op until the socket is open. */
  send: (bytes: Uint8Array<ArrayBuffer>) => void;
  /** Put the caret back in the terminal (after a panel key press). */
  focus: () => void;
}

export interface TerminalViewProps {
  name: string;
  active: boolean;
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

export function TerminalView({
  name,
  active,
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
  const fitRef = useRef<() => void>(() => undefined);
  const encoderRef = useRef(new TextEncoder());
  const [reconnecting, setReconnecting] = useState(false);
  // True until the first pty bytes land: the pane is blank until then.
  const [waiting, setWaiting] = useState(true);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  useEffect(() => {
    onControlsRef.current = onControls;
  }, [onControls]);

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

    const start = async () => {
      const terminal = await createTerminal(host, initialSize);
      if (disposed) {
        terminal.dispose();
        return;
      }
      terminalRef.current = terminal;

      // Ctrl+Shift+C copies the selection locally; paste needs no handler
      // (xterm answers the browser's own paste event with bracketed paste).
      terminal.term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) return true;
        if (event.code === "KeyC" && terminal.term.hasSelection()) {
          void navigator.clipboard.writeText(terminal.term.getSelection()).catch(() => undefined);
          return false;
        }
        return true;
      });

      // Keystrokes go out as pty bytes; pty bytes coming back get written.
      unsubscribeData = terminal.onData((data) => {
        connectionRef.current?.sendInput(encoderRef.current.encode(data));
      });
      // The single resize path: fit() changes the grid, onResize reports it.
      unsubscribeResize = terminal.onResize((next) => {
        size = next;
        onResizeRef.current?.(next);
        connectionRef.current?.sendResize(next.cols, next.rows);
      });

      connectionRef.current = connectTerminal(name, {
        onData: (bytes) => {
          setWaiting(false);
          terminal.write(bytes);
        },
        onStateChange: (state) => {
          // The first fit usually lands while the socket is still opening,
          // when sendResize is a no-op. Re-send the grid once it is live so
          // the pty starts at the rendered size.
          if (state === "live" && size) connectionRef.current?.sendResize(size.cols, size.rows);
          setReconnecting(state === "reconnecting");
          // A retry has its own chip, and a closed tab has nothing coming.
          if (state === "reconnecting" || state === "closed") setWaiting(false);
          onStateRef.current(state);
        },
      });

      fitRef.current();

      // The page keeps one registry entry per tab so its keys panel can
      // write into whichever view is active.
      onControlsRef.current?.({
        send: (bytes) => connectionRef.current?.sendInput(bytes),
        focus: () => terminalRef.current?.focus(),
      });
    };
    void start();

    return () => {
      disposed = true;
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
  }, [name]);

  // Follow the app theme; xterm.ts re-reads the CSS tokens on every call.
  useEffect(() => {
    terminalRef.current?.setTheme(resolvedTheme === "dark");
  }, [resolvedTheme]);

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
      // A resize before the async createTerminal resolves is covered by the
      // fitRef.current() call at creation.
      terminalRef.current?.fit();
      // No explicit sendResize here: fit() changes the grid, onResize
      // reports it, and that subscription is the one resize path.
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

  return (
    <div
      ref={hostRef}
      className={active ? "relative h-full w-full" : "relative hidden"}
      onMouseDown={() => terminalRef.current?.focus()}
      data-testid={`terminal-view-${name}`}
    >
      {waiting && (
        <span
          className="text-muted-foreground pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm"
          aria-live="polite"
          data-testid={`terminal-connecting-${name}`}
        >
          Connecting to sandbox…
        </span>
      )}
      {reconnecting && (
        <span
          className="bg-background/80 text-muted-foreground pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-full px-2.5 py-1 text-xs ring-1 ring-border"
          aria-live="polite"
        >
          Reconnecting…
        </span>
      )}
    </div>
  );
}
