/**
 * A streamed desktop: a noVNC canvas wired to the server's VNC WebSocket.
 *
 * The viewer stays view-only until the owner takes control. It reconnects
 * with backoff (fetching a fresh one-time ticket each try) and carries the
 * clipboard both ways. For the browser it fits the remote desktop (and
 * Chrome's window) to its box; the computer's desktop has a fixed size the
 * bot's coordinates depend on, so that viewer only scales it.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { botsApi } from "../../lib/bots-api";
import { isMac, remapMetaChord, type KeyStroke } from "../../lib/browser-keys";
import { createRfb, type RfbClient } from "../../lib/novnc";
import { reconnectingSocket } from "../../lib/reconnecting-socket";
import { remoteWindowSize } from "../../lib/remote-window";
import type { VncTicket } from "../../../shared/api/live";

export type VncState = "connecting" | "live" | "reconnecting";

export interface VncHandle {
  /** Send the local clipboard to the remote browser and press Ctrl+V. */
  paste(): Promise<void>;
  /** Press a chord the local browser would otherwise keep (Alt+Tab, Alt+F4). */
  sendKeys(strokes: KeyStroke[]): void;
  focus(): void;
}

interface VncViewProps {
  /**
   * Whose desktop: with `ticket` given, only the key that keeps one
   * connection per desktop (e.g. a computer profile on the Computer page).
   */
  botId: string;
  /** Where tickets come from; default the bot's browser or computer ticket route. */
  ticket?: () => Promise<VncTicket>;
  /** Which desktop to stream; default the bot's browser. */
  kind?: "browser" | "computer";
  /**
   * How a browser viewer fits the remote window to its box; default the
   * bot's browser resize route (the Browser page passes its profile's).
   */
  resize?: (size: { width: number; height: number }) => Promise<unknown>;
  /** False keeps the viewer view-only (the agent is driving). */
  interactive: boolean;
  onState: (state: VncState) => void;
}

/** Short: entering full screen should not leave the old window size on screen for long. */
const RESIZE_DEBOUNCE_MS = 150;
/** A failed fit is retried this many times, this far apart. */
const FIT_RETRIES = 2;
const FIT_RETRY_MS = 1000;
/** Pause between setting the remote clipboard and pressing Ctrl+V. */
const PASTE_SETTLE_MS = 80;

function socketUrl(path: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${path}`;
}

function sendStrokes(rfb: RfbClient, strokes: KeyStroke[]): void {
  for (const stroke of strokes) rfb.sendKey(stroke.keysym, stroke.code, stroke.down);
}

const PASTE_CHORD = {
  key: "v",
  code: "KeyV",
  shiftKey: false,
  altKey: false,
} as const;

export const VncView = forwardRef<VncHandle, VncViewProps>(function VncView(
  { botId, kind = "browser", ticket, resize, interactive, onState },
  ref,
) {
  const ticketRef = useRef(ticket);
  useEffect(() => {
    ticketRef.current = ticket;
  }, [ticket]);
  const resizeRef = useRef(resize);
  useEffect(() => {
    resizeRef.current = resize;
  }, [resize]);
  const hostRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbClient | null>(null);
  const interactiveRef = useRef(interactive);
  const onStateRef = useRef(onState);
  const fitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);

  // Take control = stop being view-only and grab the keyboard.
  useEffect(() => {
    interactiveRef.current = interactive;
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = !interactive;
    if (interactive) rfb.focus({ preventScroll: true });
  }, [interactive]);

  const paste = useCallback(async () => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    const text = await navigator.clipboard.readText();
    if (text) rfb.clipboardPasteFrom(text);
    await new Promise((resolve) => setTimeout(resolve, PASTE_SETTLE_MS));
    const strokes = remapMetaChord(PASTE_CHORD);
    if (strokes) sendStrokes(rfb, strokes);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      paste,
      sendKeys: (strokes) => {
        const rfb = rfbRef.current;
        if (rfb && interactiveRef.current) sendStrokes(rfb, strokes);
      },
      focus: () => rfbRef.current?.focus({ preventScroll: true }),
    }),
    [paste],
  );

  // Connection lifecycle: ticket -> noVNC -> reconnect with backoff. The
  // reconnecting socket owns the attempts; this transport only knows noVNC.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const socket = reconnectingSocket<{ path: string; scale: number }, RfbClient>(
      {
        // No ticket (session gone) retries too: the panel's status poll
        // removes this view when the session is truly gone.
        ticket: () =>
          ticketRef.current
            ? ticketRef.current()
            : kind === "computer"
              ? botsApi.computerVncTicket(botId)
              : botsApi.browserVncTicket(botId),
        open: async (ticket, events) => {
          const rfb =
            kind === "computer"
              ? await createRfb(host, socketUrl(ticket.path), ticket.scale, {
                  remoteResize: false,
                })
              : await createRfb(host, socketUrl(ticket.path), ticket.scale);
          rfbRef.current = rfb;
          rfb.viewOnly = !interactiveRef.current;
          rfb.addEventListener("connect", () => {
            events.live();
            if (interactiveRef.current) rfb.focus({ preventScroll: true });
            setTimeout(() => fitRef.current(), 300);
          });
          rfb.addEventListener("disconnect", () => {
            if (rfbRef.current === rfb) rfbRef.current = null;
            events.dropped();
          });
          rfb.addEventListener("clipboard", (event) => {
            const text = (event as CustomEvent<{ text: string }>).detail.text;
            void navigator.clipboard?.writeText(text).catch(() => {
              /* the browser may refuse without a user gesture; Paste still works */
            });
          });
          return rfb;
        },
        close: (rfb) => {
          if (rfbRef.current === rfb) rfbRef.current = null;
          rfb.disconnect();
        },
      },
      (state) => {
        // "closed" only follows this effect's own cleanup.
        if (state !== "closed") onStateRef.current(state);
      },
    );
    return () => socket.close();
  }, [botId, kind]);

  // Fit the remote Chrome window to the viewer. noVNC resizes the display
  // itself; the window inside it needs the same size (in CSS pixels), which
  // for a viewer narrower than Chrome can be is a wider one that the canvas
  // scales down. Chrome accepts a window larger than the display, so the two
  // can land in either order. One request at a time keeps the last size the
  // winner.
  useEffect(() => {
    const host = hostRef.current;
    // The computer's desktop never changes size: noVNC just scales it.
    if (!host || kind !== "browser" || typeof ResizeObserver === "undefined") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let stale = false;

    const fit = (attempt = 0) => {
      if (disposed) return;
      if (inFlight) {
        stale = true; // the box changed mid-request: fit again afterwards
        return;
      }
      inFlight = true;
      const rect = host.getBoundingClientRect();
      const desktop = remoteWindowSize(rect.width, rect.height);
      const size = {
        width: Math.max(320, Math.round(desktop.width)),
        height: Math.max(240, Math.round(desktop.height)),
      };
      void (resizeRef.current ? resizeRef.current(size) : botsApi.browserResize(botId, size))
        .then(
          () => true,
          () => false,
        )
        .then((ok) => {
          inFlight = false;
          if (disposed) return;
          if (stale) {
            stale = false;
            timer = setTimeout(() => fit(), RESIZE_DEBOUNCE_MS);
          } else if (!ok && attempt < FIT_RETRIES) {
            // Toggling full screen has no later resize to repair a failed
            // fit, and the window would stay at its old size.
            timer = setTimeout(() => fit(attempt + 1), FIT_RETRY_MS);
          }
        });
    };
    fitRef.current = () => fit();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => fit(), RESIZE_DEBOUNCE_MS);
    });
    observer.observe(host);
    return () => {
      disposed = true;
      observer.disconnect();
      clearTimeout(timer);
      fitRef.current = () => undefined;
    };
  }, [botId, kind]);

  // Cmd shortcuts on a Mac become Ctrl shortcuts on the remote Linux Chrome.
  // Captured before noVNC sees them: noVNC would send Meta as Super.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isMac()) return;
    const onKey = (event: KeyboardEvent) => {
      const rfb = rfbRef.current;
      if (!rfb || !interactiveRef.current) return;
      if (event.key !== "Meta" && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== "keydown" || event.key === "Meta") return;
      if (event.key.toLowerCase() === "v" && !event.shiftKey) {
        void paste().catch(() => {
          /* clipboard permission denied */
        });
        return;
      }
      const strokes = remapMetaChord(event);
      if (strokes) sendStrokes(rfb, strokes);
    };
    host.addEventListener("keydown", onKey, true);
    host.addEventListener("keyup", onKey, true);
    return () => {
      host.removeEventListener("keydown", onKey, true);
      host.removeEventListener("keyup", onKey, true);
    };
  }, [paste]);

  return (
    <div
      ref={hostRef}
      className="bg-muted absolute inset-0"
      data-testid={kind === "computer" ? "computer-vnc" : "browser-vnc"}
    />
  );
});
