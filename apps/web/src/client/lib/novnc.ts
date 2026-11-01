/**
 * The one place that touches noVNC. It is lazy-loaded (the library is large
 * and only the browser panel needs it) and pinned to an exact version in
 * package.json, because `scaleRemoteResize` replaces a private method.
 */
import type RFB from "@novnc/novnc";
import { remoteWindowSize } from "./remote-window";

export type RfbClient = RFB;

/** The private noVNC 1.7 fields `scaleRemoteResize` reads and writes. */
interface RfbInternals {
  _resizeSession: boolean;
  _supportsSetDesktopSize: boolean;
  _pendingRemoteResize: boolean;
  _lastResize: number;
  _resizeTimeout: ReturnType<typeof setTimeout> | null;
  _fbWidth: number;
  _fbHeight: number;
  _screenID: number;
  _screenFlags: number;
  _sock: unknown;
  _screenSize(): { w: number; h: number };
  _requestRemoteResize(): void;
}

/**
 * Replace noVNC's remote-resize request with one that
 * - asks for `scale` times the remote window's CSS size, so a 2x Chrome on
 *   the VM fills a Retina canvas with real pixels instead of an upscaled
 *   blur (the window is the viewer's box, or wider when Chrome cannot be
 *   that narrow, see `remoteWindowSize`), and
 * - also works while the viewer is view-only: the panel must fit the remote
 *   desktop to its box before the owner takes control.
 * Everything else matches noVNC's own implementation.
 */
function scaleRemoteResize(rfb: RFB, rfbClass: typeof RFB, scale: number): void {
  const internals = rfb as unknown as RfbInternals;
  internals._requestRemoteResize = function (this: RfbInternals) {
    if (!this._resizeSession || !this._supportsSetDesktopSize) return;
    if (this._pendingRemoteResize) return;

    // At most one request per 100ms; a burst collapses into the last one.
    const sinceLast = Date.now() - this._lastResize;
    if (sinceLast < 100) {
      if (this._resizeTimeout) clearTimeout(this._resizeTimeout);
      this._resizeTimeout = setTimeout(() => this._requestRemoteResize(), 100 - sinceLast);
      return;
    }
    this._resizeTimeout = null;

    const size = this._screenSize();
    const desktop = remoteWindowSize(size.w, size.h);
    const width = Math.floor(desktop.width * scale);
    const height = Math.floor(desktop.height * scale);
    if (width === this._fbWidth && height === this._fbHeight) return;

    this._pendingRemoteResize = true;
    this._lastResize = Date.now();
    rfbClass.messages.setDesktopSize(this._sock, width, height, this._screenID, this._screenFlags);
  };
}

/**
 * Open a viewer in `host`. It starts view-only; the caller enables input.
 * With `remoteResize: false` (the computer's fixed-size desktop) the viewer
 * only scales the remote screen and never asks it to change size.
 */
export async function createRfb(
  host: HTMLElement,
  url: string,
  scale: number,
  { remoteResize = true }: { remoteResize?: boolean } = {},
): Promise<RFB> {
  const { default: RfbClass } = await import("@novnc/novnc");
  const rfb = new RfbClass(host, url, { shared: true });
  rfb.scaleViewport = true;
  rfb.resizeSession = remoteResize;
  rfb.clipViewport = false;
  rfb.focusOnClick = true;
  rfb.showDotCursor = false;
  rfb.background = "transparent";
  // Tight/JPEG tradeoff upsy.ai ships: sharp enough for text, light on the link.
  rfb.qualityLevel = 8;
  rfb.compressionLevel = 2;
  rfb.viewOnly = true;
  if (remoteResize) scaleRemoteResize(rfb, RfbClass, scale);
  return rfb;
}
