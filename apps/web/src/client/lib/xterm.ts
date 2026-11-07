/**
 * The one place that touches xterm.js. Like novnc.ts, the library is
 * lazy-loaded (it is large and only the terminal page needs it) and pinned
 * to an exact version in package.json. The page owns the ResizeObserver +
 * debounce and pushes sizes over the WebSocket; this handle renders, and
 * owns everything that is about xterm itself:
 *
 * - Clipboard. xterm turns Ctrl+V into a ^V byte and cancels the event, so
 *   the browser never fires `paste` (Windows/Linux paste simply did not
 *   work). `classifyKey` lets the paste chords through to the browser,
 *   whose native paste event xterm answers with bracketed paste. That works
 *   on plain http too, where `navigator.clipboard` does not exist. Copy
 *   comes two ways: tmux's own mouse selection arrives as OSC 52 (the
 *   clipboard addon below), and Shift/Option+drag makes a local selection
 *   that Ctrl+C / Ctrl+Shift+C / Cmd+C copies.
 * - Glyph widths. tmux measures emoji and CJK with a modern width table;
 *   xterm defaults to Unicode 6, so the two disagreed about where the cursor
 *   was and TUIs (Claude Code, htop, starship prompts) smeared. The unicode11
 *   addon makes them agree.
 * - Fonts. Cell size is measured when the terminal opens; a webfont that
 *   lands later leaves every glyph misplaced. The atlas is rebuilt and the
 *   grid refitted once `document.fonts` settles.
 */
import type { Terminal, ITheme, ITerminalOptions, ITerminalInitOnlyOptions } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { IClipboardProvider } from "@xterm/addon-clipboard";
import { copyText, isMac } from "./clipboard";

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Font size bounds the page's A-/A+ and Ctrl+-/= stay inside. */
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const DEFAULT_FONT_SIZE = 14;

/**
 * System monospace faces only: nothing to download, so the first measure is
 * the real one. Ordered by platform (macOS, Windows, Linux) with the
 * generic last.
 */
const TERMINAL_FONT_FAMILY =
  '"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Mono", "Cascadia Code", Consolas, "JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", monospace';

export interface TerminalOptions {
  fontFamily?: string;
  fontSize?: number;
  /** Grid before the first fit; the fit addon owns it afterwards. */
  cols?: number;
  rows?: number;
  /** Local scrollback lines. tmux history on the VM is the real buffer. */
  scrollback?: number;
  /**
   * Text went to the clipboard (a tmux selection or a local copy). `ok` is
   * false when the browser refused every route.
   */
  onCopy?: (text: string, ok: boolean) => void;
  /** Ctrl/Cmd + = / - / 0 while the terminal has focus. */
  onFontSizeKey?: (step: 1 | -1 | 0) => void;
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
  /**
   * Render pty bytes (or local text). Partial UTF-8 chunks are safe.
   * `done` runs once xterm has parsed the chunk (flow control counts it).
   */
  write(data: Uint8Array | string, done?: () => void): void;
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
  /** Change the font size and refit (the grid follows). */
  setFontSize(px: number): void;
  /** Send text as a paste: bracketed when the app asked, newlines normalised. */
  paste(text: string): void;
  /** Copy the local selection; false when there was none or it was refused. */
  copySelection(): Promise<boolean>;
  hasSelection(): boolean;
  selectAll(): void;
  /** Wipe local state (modes, screen) before a fresh attach redraws it. */
  reset(): void;
  focus(): void;
  dispose(): void;
}

/** What a keydown means to the terminal, before xterm sees it. */
export type KeyAction =
  /** Let the browser fire its native paste event (xterm handles it). */
  | "native-paste"
  /** Copy the local selection ourselves. */
  | "copy"
  | "font-up"
  | "font-down"
  | "font-reset"
  /** Not ours: xterm encodes it for the pty as usual. */
  | "pass";

/** The subset of KeyboardEvent the classifier reads. */
export type KeyLike = Pick<
  KeyboardEvent,
  "type" | "code" | "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

/**
 * Classify a key event. Ctrl+C without a selection stays ^C (an interrupt
 * must never be eaten), and with one it copies, the Windows Terminal rule.
 * On macOS Ctrl is left alone entirely: Ctrl+V is ^V there by convention
 * and Cmd does the clipboard.
 */
export function classifyKey(event: KeyLike, mac: boolean, hasSelection: boolean): KeyAction {
  if (event.type !== "keydown" || event.altKey) return "pass";
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  // Shift+Insert is the X11/Windows paste chord; browsers fire paste for it.
  if (!mac && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "Insert") {
    return "native-paste";
  }
  if (!primary) return "pass";

  switch (event.code) {
    case "KeyV":
      return "native-paste";
    case "KeyC":
      // Ctrl+Shift+C is always ours (it would otherwise open Chrome's
      // element inspector, or reach the pty as ^C). Cmd+C and plain Ctrl+C
      // copy only when there is a selection; Ctrl+C is ^C otherwise.
      if (!mac && event.shiftKey) return "copy";
      return hasSelection ? "copy" : "pass";
    case "Equal":
    case "NumpadAdd":
      return "font-up";
    case "Minus":
    case "NumpadSubtract":
      return "font-down";
    case "Digit0":
    case "Numpad0":
      return event.shiftKey ? "pass" : "font-reset";
    default:
      return "pass";
  }
}

/** Resolve any CSS colour (the tokens are oklch) to `#rrggbb` via a canvas. */
function toHex(css: string | undefined, fallback: string): string {
  if (!css) return fallback;
  if (/^#[\da-f]{6}$/i.test(css)) return css;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.fillStyle = fallback;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

/**
 * ANSI palettes tuned per mode. xterm's stock palette is built for a black
 * background: on the light theme its yellow and white were unreadable.
 */
const DARK_ANSI = {
  black: "#3b3b3b",
  red: "#f07178",
  green: "#a5d86e",
  yellow: "#e6c07b",
  blue: "#6cb6ff",
  magenta: "#d4a0f7",
  cyan: "#56d4dd",
  white: "#d6d6d6",
  brightRed: "#ff8b92",
  brightGreen: "#bfeb8c",
  brightYellow: "#ffd98e",
  brightBlue: "#8fcaff",
  brightMagenta: "#e5b8ff",
  brightCyan: "#7ce8ef",
  brightWhite: "#ffffff",
} as const;

const LIGHT_ANSI = {
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#8a6100",
  blue: "#0550ae",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#7d4e00",
  brightBlue: "#0969da",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
} as const;

/**
 * Palette from the app's own tokens, read live so the terminal follows the
 * theme without a second surface colour to maintain. Every colour handed to
 * xterm is hex: its WebGL atlas cannot take oklch, and a translucent token
 * made it throw and fall back to its default selection colour.
 */
function terminalTheme(dark: boolean): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string): string | undefined => {
    const value = styles.getPropertyValue(name).trim();
    return value || undefined;
  };
  const background = toHex(token("--background"), dark ? "#141414" : "#fafafa");
  const foreground = toHex(token("--foreground"), dark ? "#ededed" : "#1a1a1a");
  const muted = toHex(token("--muted-foreground"), dark ? "#8a8a8a" : "#6b6b6b");
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    // The foreground at ~30% reads as a selection on either theme.
    selectionBackground: `${foreground}4d`,
    selectionInactiveBackground: `${foreground}26`,
    scrollbarSliderBackground: `${foreground}1f`,
    scrollbarSliderHoverBackground: `${foreground}38`,
    scrollbarSliderActiveBackground: `${foreground}52`,
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
    // The one ANSI slot UI text leans on (dim prompts, comments).
    brightBlack: muted,
  };
}

/** Links open only with Cmd/Ctrl held, so a click to select never navigates. */
function openLink(event: MouseEvent, uri: string): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  window.open(url.href, "_blank", "noopener,noreferrer");
}

/** Open a terminal in `host`. Theme follows the app at creation time. */
export async function createTerminal(
  host: HTMLElement,
  options: TerminalOptions = {},
): Promise<TerminalHandle> {
  const [
    { Terminal: TerminalClass },
    { FitAddon },
    { WebglAddon: WebglAddonClass },
    { Unicode11Addon },
    { ClipboardAddon },
    { WebLinksAddon },
  ] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-webgl"),
    import("@xterm/addon-unicode11"),
    import("@xterm/addon-clipboard"),
    import("@xterm/addon-web-links"),
    import("@xterm/xterm/css/xterm.css"),
  ]);
  const mac = isMac();

  // Undefined keys would overwrite xterm's defaults, so only set what was given.
  const init: ITerminalOptions & ITerminalInitOnlyOptions = {
    cursorBlink: true,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    fontFamily: options.fontFamily ?? TERMINAL_FONT_FAMILY,
    fontSize: options.fontSize ?? DEFAULT_FONT_SIZE,
    lineHeight: 1.15,
    // Unicode11Addon registers through the proposed unicode API.
    allowProposedApi: true,
    // Shift+drag (Option+drag on macOS) selects locally even while tmux has
    // the mouse; without this macOS had no way to make a local selection.
    macOptionClickForcesSelection: true,
    // Right-click is the page's context menu, not a word select.
    rightClickSelectsWord: false,
    // A big paste stays one paste: tmux and the shell see it bracketed.
    ignoreBracketedPasteMode: false,
    scrollback: options.scrollback ?? 1000,
    // Smooth wheel feels laggy over a remote pty; tmux owns history anyway.
    smoothScrollDuration: 0,
    drawBoldTextInBrightColors: false,
    theme: terminalTheme(document.documentElement.classList.contains("dark")),
    // OSC 8 hyperlinks (tmux passes them through): same Cmd/Ctrl rule.
    linkHandler: { activate: openLink, allowNonHttpProtocols: false },
  };
  if (options.cols !== undefined) init.cols = options.cols;
  if (options.rows !== undefined) init.rows = options.rows;

  const term = new TerminalClass(init);

  const unicode = new Unicode11Addon();
  term.loadAddon(unicode);
  term.unicode.activeVersion = "11";

  term.open(host);

  const fit = new FitAddon();
  term.loadAddon(fit);

  // OSC 52 from tmux (`set-clipboard on`). tmux sends an empty selection
  // parameter, which the stock provider ignores (it only takes "c"), so
  // every tmux copy was silently dropped. Reads are refused: a program on
  // the VM must never be able to read the owner's clipboard.
  const clipboardProvider: IClipboardProvider = {
    readText: () => "",
    writeText: async (selection, text) => {
      if (selection !== "c" && (selection as string) !== "") return;
      if (!text) return;
      const ok = await copyText(text);
      options.onCopy?.(text, ok);
    },
  };
  term.loadAddon(new ClipboardAddon(undefined, clipboardProvider));
  term.loadAddon(new WebLinksAddon(openLink));

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
      webgl = undefined;
    });
    term.loadAddon(webgl);
  } catch {
    // No WebGL2 (driver blocklist, remote desktop): keep the DOM renderer.
    try {
      webgl?.dispose();
    } catch {
      // Activation threw before the renderer existed; nothing to release.
    }
    webgl = undefined;
  }

  let disposed = false;
  const measurable = (): TerminalSize | null => {
    // A hidden (display:none) host measures 0x0 and the fit addon would
    // shrink the grid to its minimum, making tmux redraw everything at a
    // tiny size and again on show. Hidden hosts never fit.
    if (host.clientWidth === 0 || host.clientHeight === 0) return null;
    const size = fit.proposeDimensions();
    if (!size || Number.isNaN(size.cols) || Number.isNaN(size.rows)) return null;
    if (size.cols < 2 || size.rows < 2) return null;
    return { cols: size.cols, rows: size.rows };
  };
  const refit = (): TerminalSize | null => {
    const size = measurable();
    if (!size) return null;
    if (size.cols !== term.cols || size.rows !== term.rows) fit.fit();
    return { cols: term.cols, rows: term.rows };
  };

  const copySelection = async (): Promise<boolean> => {
    const text = term.getSelection();
    if (!text) return false;
    const ok = await copyText(text);
    options.onCopy?.(text, ok);
    // Windows Terminal rule: once copied, the next Ctrl+C is an interrupt.
    if (ok && !disposed) term.clearSelection();
    return ok;
  };

  term.attachCustomKeyEventHandler((event) => {
    const action = classifyKey(event, mac, term.hasSelection());
    switch (action) {
      case "pass":
        return true;
      case "native-paste":
        // Returning false (without preventDefault) skips xterm's ^V and lets
        // the browser deliver its paste event to xterm's textarea.
        return false;
      case "copy":
        event.preventDefault();
        void copySelection();
        return false;
      case "font-up":
      case "font-down":
      case "font-reset":
        event.preventDefault();
        options.onFontSizeKey?.(action === "font-up" ? 1 : action === "font-down" ? -1 : 0);
        return false;
    }
  });

  // Cell metrics were measured with whatever font was ready at open().
  // When the font set settles, rebuild the glyph atlas and refit once.
  void document.fonts?.ready.then(() => {
    if (disposed) return;
    term.clearTextureAtlas();
    refit();
  });

  return {
    term,
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    write(data, done) {
      if (disposed) {
        done?.();
        return;
      }
      term.write(data, done);
    },
    onData(listener) {
      const subscription = term.onData(listener);
      return () => subscription.dispose();
    },
    onResize(listener) {
      const subscription = term.onResize(({ cols, rows }) => listener({ cols, rows }));
      return () => subscription.dispose();
    },
    fit: refit,
    proposeDimensions: measurable,
    setTheme(dark) {
      if (disposed) return;
      term.options.theme = terminalTheme(dark);
      // Glyphs are cached per colour in the atlas; stale entries showed the
      // old theme's colours in patches until each cell repainted.
      term.clearTextureAtlas();
    },
    setFontSize(px) {
      if (disposed || term.options.fontSize === px) return;
      term.options.fontSize = px;
      term.clearTextureAtlas();
      refit();
    },
    paste(text) {
      if (!disposed && text) term.paste(text);
    },
    copySelection,
    hasSelection: () => !disposed && term.hasSelection(),
    selectAll() {
      if (!disposed) term.selectAll();
    },
    reset() {
      if (!disposed) term.reset();
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
