import type { Terminal, ITheme, ITerminalOptions, ITerminalInitOnlyOptions } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { IClipboardProvider } from "@xterm/addon-clipboard";
import { copyText, isMac } from "./clipboard";

export interface TerminalSize {
  cols: number;
  rows: number;
}

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const DEFAULT_FONT_SIZE = 14;

const TERMINAL_FONT_FAMILY =
  '"SF Mono", ui-monospace, Menlo, Monaco, "Cascadia Mono", "Cascadia Code", Consolas, "JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono", monospace';

export interface TerminalOptions {
  fontFamily?: string;
  fontSize?: number;
  cols?: number;
  rows?: number;
  scrollback?: number;
  onCopy?: (text: string, ok: boolean) => void;
  onFontSizeKey?: (step: 1 | -1 | 0) => void;
}

export interface TerminalHandle {
  readonly term: Terminal;
  readonly cols: number;
  readonly rows: number;
  write(data: Uint8Array | string, done?: () => void): void;
  onData(listener: (data: string) => void): () => void;
  onResize(listener: (size: TerminalSize) => void): () => void;
  fit(): TerminalSize | null;
  proposeDimensions(): TerminalSize | null;
  setTheme(dark: boolean): void;
  setFontSize(px: number): void;
  paste(text: string): void;
  copySelection(): Promise<boolean>;
  hasSelection(): boolean;
  selectAll(): void;
  reset(): void;
  focus(): void;
  dispose(): void;
}

export type KeyAction = "native-paste" | "copy" | "font-up" | "font-down" | "font-reset" | "pass";

export type KeyLike = Pick<
  KeyboardEvent,
  "type" | "code" | "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

export function classifyKey(event: KeyLike, mac: boolean, hasSelection: boolean): KeyAction {
  if (event.type !== "keydown" || event.altKey) return "pass";
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  if (!mac && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "Insert") {
    return "native-paste";
  }
  if (!primary) return "pass";

  switch (event.code) {
    case "KeyV":
      return "native-paste";
    case "KeyC":
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
    selectionBackground: `${foreground}4d`,
    selectionInactiveBackground: `${foreground}26`,
    scrollbarSliderBackground: `${foreground}1f`,
    scrollbarSliderHoverBackground: `${foreground}38`,
    scrollbarSliderActiveBackground: `${foreground}52`,
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
    brightBlack: muted,
  };
}

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

  const init: ITerminalOptions & ITerminalInitOnlyOptions = {
    cursorBlink: true,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    fontFamily: options.fontFamily ?? TERMINAL_FONT_FAMILY,
    fontSize: options.fontSize ?? DEFAULT_FONT_SIZE,
    lineHeight: 1.15,
    allowProposedApi: true,
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: false,
    ignoreBracketedPasteMode: false,
    scrollback: options.scrollback ?? 1000,
    smoothScrollDuration: 0,
    drawBoldTextInBrightColors: false,
    theme: terminalTheme(document.documentElement.classList.contains("dark")),
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
      try {
        webgl?.dispose();
      } catch {}
      webgl = undefined;
    });
    term.loadAddon(webgl);
  } catch {
    try {
      webgl?.dispose();
    } catch {}
    webgl = undefined;
  }

  let disposed = false;
  const measurable = (): TerminalSize | null => {
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
    if (ok && !disposed) term.clearSelection();
    return ok;
  };

  term.attachCustomKeyEventHandler((event) => {
    const action = classifyKey(event, mac, term.hasSelection());
    switch (action) {
      case "pass":
        return true;
      case "native-paste":
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
        term.dispose();
      } catch {}
    },
  };
}
