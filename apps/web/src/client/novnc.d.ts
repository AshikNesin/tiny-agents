declare module "@novnc/novnc" {
  export interface RfbOptions {
    shared?: boolean;
    wsProtocols?: string[];
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: RfbOptions);
    static messages: {
      setDesktopSize(
        sock: unknown,
        width: number,
        height: number,
        screenId: number,
        flags: number,
      ): void;
    };
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    clipViewport: boolean;
    focusOnClick: boolean;
    showDotCursor: boolean;
    background: string;
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
    focus(options?: FocusOptions): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
  }
}
