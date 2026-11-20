import type RFB from "@novnc/novnc";
import { remoteWindowSize } from "./remote-window";

export type RfbClient = RFB;

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

function scaleRemoteResize(rfb: RFB, rfbClass: typeof RFB, scale: number): void {
  const internals = rfb as unknown as RfbInternals;
  internals._requestRemoteResize = function (this: RfbInternals) {
    if (!this._resizeSession || !this._supportsSetDesktopSize) return;
    if (this._pendingRemoteResize) return;

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
  rfb.qualityLevel = 8;
  rfb.compressionLevel = 2;
  rfb.viewOnly = true;
  if (remoteResize) scaleRemoteResize(rfb, RfbClass, scale);
  return rfb;
}
