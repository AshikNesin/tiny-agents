/**
 * The one place that touches xterm.js. Like novnc.ts, the library is
 * lazy-loaded (it is large and only the terminal page needs it) and pinned
 * to an exact version in package.json. The page owns the ResizeObserver +
 * debounce and pushes sizes over the WebSocket; this handle only renders.
 */
import type { Terminal, ITheme, ITerminalOptions, ITerminalInitOnlyOptions } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";

export type { Terminal } from "@xterm/xterm";

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalOptions {
  fontFamily?: string;
  fontSize?: number;
  /** Grid before the first fit; the fit addon owns it afterwards. */
  cols?: number;
  rows?: number;
  /** Local scrollback lines. tmux history on the VM is the real buffer. */
  scrollback?: number;
}

/**
 * What the terminal page needs from an xterm instance. Subscriptions return
 * their unsubscribe; everything is a no-op after dispose (React may unmount
 * and remount around a handle).
 */
export interface TerminalHandle {
  readonly term: Terminal;
  readonly cols: number;
  readonly rows: number;
  /** Render pty bytes (or local text). Partial UTF-8 chunks are safe. */
  write(data: Uint8Array | string): void;
  /** Keystrokes and bracketed paste, as typed. Forward to the WS as bytes. */
  onData(listener: (data: string) => void): () => void;
  /** Fires when the grid changes, including after fit(). */
  onResize(listener: (size: TerminalSize) => void): () => void;
  /** Fit to the host's current box; null when it has no measurable size. */
  fit(): TerminalSize | null;
  /** The size fit() would land on, without applying it. */
  proposeDimensions(): TerminalSize | null;
  /** Re-read the app's CSS tokens and restyle for the given mode. */
  setTheme(dark: boolean): void;
  focus(): void;
  dispose(): void;
}

/**
 * Palette from the app's own tokens, read live so the terminal follows the
 * theme without a second palette to maintain. The tokens below are authored
 * as hex in app.css; the WebGL atlas parser only understands hex/rgba
 * strings, so keep them that way.
 */
function terminalTheme(dark: boolean): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string): string | undefined => {
    const value = styles.getPropertyValue(name).trim();
    return value || undefined;
  };
  const background = token("--background") ?? (dark ? "#000000" : "#ffffff");
  const foreground = token("--foreground") ?? (dark ? "#ffffff" : "#000000");
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: token("--muted"),
    selectionInactiveBackground: token("--muted"),
    // The one ANSI slot UI text leans on; the rest keep xterm's palette so
    // program colors (vim, htop) render as their authors intended.
    brightBlack: token("--muted-foreground"),
    black: "#000000",
    white: "#ffffff",
  };
}

/** Open a terminal in `host`. Theme follows the app at creation time. */
export async function createTerminal(
  host: HTMLElement,
  options: TerminalOptions = {},
): Promise<TerminalHandle> {
  const [{ Terminal: TerminalClass }, { FitAddon }, { WebglAddon: WebglAddonClass }] =
    await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-webgl"),
      import("@xterm/xterm/css/xterm.css"),
    ]);

  // Undefined keys would overwrite xterm's defaults, so only set what was given.
  const init: ITerminalOptions & ITerminalInitOnlyOptions & { cursorBlink: true } = {
    cursorBlink: true,
    theme: terminalTheme(document.documentElement.classList.contains("dark")),
  };
  if (options.fontFamily !== undefined) init.fontFamily = options.fontFamily;
  if (options.fontSize !== undefined) init.fontSize = options.fontSize;
  if (options.cols !== undefined) init.cols = options.cols;
  if (options.rows !== undefined) init.rows = options.rows;
  if (options.scrollback !== undefined) init.scrollback = options.scrollback;

  const term = new TerminalClass(init);
  term.open(host);

  const fit = new FitAddon();
  term.loadAddon(fit);

  let webgl: WebglAddon | undefined;
  try {
    webgl = new WebglAddonClass();
    webgl.onContextLoss(() => {
      // Disposing the renderer makes xterm fall back to its DOM renderer.
      try {
        webgl?.dispose();
      } catch {
        // The context is already gone; the DOM renderer takes over either way.
      }
    });
    term.loadAddon(webgl);
  } catch {
    // No WebGL2 (driver blocklist, remote desktop): keep the DOM renderer.
    try {
      webgl?.dispose();
    } catch {
      // Activation threw before the renderer existed; nothing to release.
    }
  }

  let disposed = false;
  const measurable = (): TerminalSize | null => {
    const size = fit.proposeDimensions();
    if (!size || Number.isNaN(size.cols) || Number.isNaN(size.rows)) return null;
    return { cols: size.cols, rows: size.rows };
  };

  return {
    term,
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    write(data) {
      if (!disposed) term.write(data);
    },
    onData(listener) {
      const subscription = term.onData(listener);
      return () => subscription.dispose();
    },
    onResize(listener) {
      const subscription = term.onResize(({ cols, rows }) => listener({ cols, rows }));
      return () => subscription.dispose();
    },
    fit() {
      const size = measurable();
      if (!size) return null;
      fit.fit();
      return { cols: term.cols, rows: term.rows };
    },
    proposeDimensions: measurable,
    setTheme(dark) {
      if (!disposed) term.options.theme = terminalTheme(dark);
    },
    focus() {
      if (!disposed) term.focus();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        // Also disposes loaded addons; a failed WebGL addon is a no-op here.
        term.dispose();
      } catch {
        // A half-dead renderer must not block unmounting.
      }
    },
  };
}
