import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { botVncTicket, resizeBotBrowser } from "../../lib/vnc-session";
import { isMac, remapMetaChord, type KeyStroke } from "../../lib/browser-keys";
import { ignoreClipboardRefusal, sayClipboardReadRefused } from "../../lib/clipboard";
import { createRfb, type RfbClient } from "../../lib/novnc";
import { reconnectingSocket } from "../../lib/reconnecting-socket";
import { remoteWindowSize } from "../../lib/remote-window";
import type { VncTicket } from "../../../shared/api/live";

export type VncState = "connecting" | "live" | "reconnecting";

export interface VncHandle {
  paste(): Promise<void>;
  sendKeys(strokes: KeyStroke[]): void;
  focus(): void;
}

interface VncViewProps {
  botId: string;
  ticket?: () => Promise<VncTicket>;
  kind?: "browser" | "computer";
  resize?: (size: { width: number; height: number }) => Promise<unknown>;
  remoteResize?: boolean;
  onDisplaySize?: (size: { width: number; height: number }) => void;
  interactive: boolean;
  onState: (state: VncState) => void;
}

const RESIZE_DEBOUNCE_MS = 150;
const FIT_RETRIES = 2;
const FIT_RETRY_MS = 1000;
const PASTE_SETTLE_MS = 80;

function resizeFailedSoFitRetries(): boolean {
  return false;
}

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
  {
    botId,
    kind = "browser",
    ticket,
    resize,
    remoteResize = true,
    interactive,
    onState,
    onDisplaySize,
  },
  ref,
) {
  const remoteResizeRef = useRef(remoteResize);
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

  useLayoutEffect(() => {
    remoteResizeRef.current = remoteResize;
    const rfb = rfbRef.current;
    if (rfb && kind === "browser" && rfb.resizeSession !== remoteResize)
      rfb.resizeSession = remoteResize;
  }, [remoteResize, kind]);

  const onDisplaySizeRef = useRef(onDisplaySize);
  useEffect(() => {
    onDisplaySizeRef.current = onDisplaySize;
  }, [onDisplaySize]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof MutationObserver === "undefined") return;
    const report = () => {
      const canvas = host.querySelector("canvas");
      if (canvas && canvas.width > 0 && canvas.height > 0)
        onDisplaySizeRef.current?.({ width: canvas.width, height: canvas.height });
    };
    const observer = new MutationObserver(report);
    observer.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["width", "height"],
    });
    return () => observer.disconnect();
  }, []);

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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const socket = reconnectingSocket<{ path: string; scale: number }, RfbClient>(
      {
        ticket: () => (ticketRef.current ? ticketRef.current() : botVncTicket(kind, botId)),
        open: async (ticket, events) => {
          const rfb =
            kind === "computer"
              ? await createRfb(host, socketUrl(ticket.path), ticket.scale, {
                  remoteResize: false,
                })
              : await createRfb(host, socketUrl(ticket.path), ticket.scale);
          rfbRef.current = rfb;
          if (kind === "browser") rfb.resizeSession = remoteResizeRef.current;
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
            void navigator.clipboard?.writeText(text).catch(ignoreClipboardRefusal);
          });
          return rfb;
        },
        close: (rfb) => {
          if (rfbRef.current === rfb) rfbRef.current = null;
          rfb.disconnect();
        },
      },
      (state) => {
        if (state !== "closed") onStateRef.current(state);
      },
    );
    return () => socket.close();
  }, [botId, kind]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || kind !== "browser" || typeof ResizeObserver === "undefined") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let stale = false;

    const fit = (attempt = 0) => {
      if (disposed) return;
      if (inFlight) {
        stale = true;
        return;
      }
      inFlight = true;
      const rect = host.getBoundingClientRect();
      const desktop = remoteWindowSize(rect.width, rect.height);
      const size = {
        width: Math.max(320, Math.round(desktop.width)),
        height: Math.max(240, Math.round(desktop.height)),
      };
      void (resizeRef.current ? resizeRef.current(size) : resizeBotBrowser(botId, size))
        .then(() => true, resizeFailedSoFitRetries)
        .then((ok) => {
          inFlight = false;
          if (disposed) return;
          if (stale) {
            stale = false;
            timer = setTimeout(() => fit(), RESIZE_DEBOUNCE_MS);
          } else if (!ok && attempt < FIT_RETRIES) {
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
        void paste().catch(sayClipboardReadRefused);
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
