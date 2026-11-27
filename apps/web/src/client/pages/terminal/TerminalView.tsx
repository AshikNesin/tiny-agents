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

export interface TerminalControls {
  send: (bytes: Uint8Array<ArrayBuffer>) => void;
  paste: (text: string) => void;
  focus: () => void;
}

export interface TerminalViewProps {
  name: string;
  active: boolean;
  fontSize: number;
  onFontSizeKey?: (step: 1 | -1 | 0) => void;
  onState: (state: TerminalConnectionState) => void;
  onResize?: (size: TerminalSize) => void;
  initialSize?: TerminalSize;
  onControls?: (controls: TerminalControls | null) => void;
}

const RESIZE_DEBOUNCE_MS = 150;
const SIZE_BADGE_MS = 900;

const ENCODER = new TextEncoder();

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
  const [waiting, setWaiting] = useState(true);
  const [sizeBadge, setSizeBadge] = useState<TerminalSize | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; canCopy: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    onStateRef.current = onState;
    onResizeRef.current = onResize;
    onControlsRef.current = onControls;
    onFontSizeKeyRef.current = onFontSizeKey;
  }, [onState, onResize, onControls, onFontSizeKey]);

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

      unsubscribeData = terminal.onData((data) => {
        connectionRef.current?.sendInput(ENCODER.encode(data));
      });
      unsubscribeResize = terminal.onResize((next) => {
        size = next;
        onResizeRef.current?.(next);
        connectionRef.current?.sendResize(next.cols, next.rows);
        setSizeBadge(next);
        clearTimeout(badgeTimer);
        badgeTimer = setTimeout(() => setSizeBadge(null), SIZE_BADGE_MS);
      });

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
            if (wasLive) terminal.reset();
            wasLive = true;
            if (size) connectionRef.current?.sendResize(size.cols, size.rows);
          }
          if (state === "reconnecting" || state === "closed") setWaiting(false);
          setConnection(state);
          onStateRef.current(state);
        },
      });

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
  }, [name, attempt]);

  useEffect(() => {
    terminalRef.current?.setTheme(resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    fontSizeRef.current = fontSize;
    terminalRef.current?.setFontSize(fontSize);
  }, [fontSize]);

  useEffect(() => {
    if (!active) return;
    fitRef.current();
    terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fit = () => {
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
        <DropdownMenuTrigger
          render={
            <span
              aria-hidden
              className="pointer-events-none fixed size-0"
              style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
            />
          }
        />
        <DropdownMenuContent
          align="start"
          className="w-56"
          finalFocus={() => {
            terminalRef.current?.focus();
            return false;
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
