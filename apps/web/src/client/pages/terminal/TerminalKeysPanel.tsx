import { useState, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@groot/ui/lib/utils";
import { pasteFromClipboard, type TerminalControls } from "./TerminalView";

interface PanelKey {
  testid: string;
  label?: string;
  icon?: LucideIcon;
  aria: string;
  char?: string;
  seq?: string;
}

const NAV_KEYS: PanelKey[] = [
  { testid: "terminal-key-esc", label: "esc", aria: "Esc", seq: "\x1b" },
  { testid: "terminal-key-tab", label: "tab", aria: "Tab", seq: "\t" },
  { testid: "terminal-key-arrow-up", icon: ChevronUp, aria: "Arrow up", seq: "\x1b[A" },
  { testid: "terminal-key-arrow-down", icon: ChevronDown, aria: "Arrow down", seq: "\x1b[B" },
  { testid: "terminal-key-arrow-left", icon: ChevronLeft, aria: "Arrow left", seq: "\x1b[D" },
  { testid: "terminal-key-arrow-right", icon: ChevronRight, aria: "Arrow right", seq: "\x1b[C" },
  { testid: "terminal-key-home", label: "home", aria: "Home", seq: "\x1b[H" },
  { testid: "terminal-key-end", label: "end", aria: "End", seq: "\x1b[F" },
  { testid: "terminal-key-pgup", label: "pgup", aria: "Page up", seq: "\x1b[5~" },
  { testid: "terminal-key-pgdn", label: "pgdn", aria: "Page down", seq: "\x1b[6~" },
];

const CONTROL_KEYS: PanelKey[] = [
  { testid: "terminal-key-ctrl-c", label: "^C", aria: "Ctrl+C", seq: "\x03" },
  { testid: "terminal-key-ctrl-d", label: "^D", aria: "Ctrl+D", seq: "\x04" },
  { testid: "terminal-key-ctrl-z", label: "^Z", aria: "Ctrl+Z", seq: "\x1a" },
  { testid: "terminal-key-ctrl-l", label: "^L", aria: "Ctrl+L", seq: "\x0c" },
  { testid: "terminal-key-ctrl-r", label: "^R", aria: "Ctrl+R", seq: "\x12" },
];

const SYMBOL_KEYS: PanelKey[] = [
  { testid: "terminal-key-pipe", label: "|", aria: "Pipe", char: "|" },
  { testid: "terminal-key-backslash", label: "\\", aria: "Backslash", char: "\\" },
  { testid: "terminal-key-tilde", label: "~", aria: "Tilde", char: "~" },
  { testid: "terminal-key-minus", label: "-", aria: "Minus", char: "-" },
];

const ENCODER = new TextEncoder();

function composeKey(key: PanelKey, ctrl: boolean, alt: boolean): string {
  if (key.char === undefined) return key.seq ?? "";
  const base =
    ctrl && /^[a-z]$/.test(key.char)
      ? String.fromCharCode(key.char.charCodeAt(0) & 0x1f)
      : key.char;
  return alt ? `\x1b${base}` : base;
}

const keepFocus = (event: MouseEvent) => event.preventDefault();

const keyClass =
  "flex h-8 min-h-8 items-center justify-center rounded-md px-1 font-mono text-[11px] text-muted-foreground select-none hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground md:min-w-8";

function KeyButton({ spec, onPress }: { spec: PanelKey; onPress: () => void }) {
  const Icon = spec.icon;
  return (
    <button
      type="button"
      aria-label={spec.aria}
      onMouseDown={keepFocus}
      onClick={onPress}
      className={keyClass}
      data-testid={spec.testid}
    >
      {Icon ? <Icon className="size-3.5" /> : spec.label}
    </button>
  );
}

export function TerminalKeysPanel({
  getControls,
  onCollapse,
}: {
  getControls: () => TerminalControls | undefined;
  onCollapse: () => void;
}) {
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);

  const press = (key: PanelKey) => {
    setCtrl(false);
    setAlt(false);
    const controls = getControls();
    controls?.send(ENCODER.encode(composeKey(key, ctrl, alt)));
    controls?.focus();
  };

  const paste = async () => {
    setCtrl(false);
    setAlt(false);
    await pasteFromClipboard((text) => {
      const controls = getControls();
      controls?.paste(text);
      controls?.focus();
    });
  };

  const modifier = (active: boolean, toggle: () => void, label: string, testid: string) => (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onMouseDown={keepFocus}
      onClick={toggle}
      className={cn(keyClass, "aria-pressed:bg-muted aria-pressed:text-foreground")}
      data-testid={testid}
    >
      {label}
    </button>
  );

  return (
    <aside
      aria-label="Terminal keys"
      className={cn(
        "absolute inset-y-1 right-1 z-10 flex w-28 flex-col rounded-lg bg-background/80 backdrop-blur-sm",
        "md:static md:z-auto md:w-44 md:shrink-0 md:rounded-none md:border-l md:border-border/50 md:bg-transparent md:backdrop-blur-none",
      )}
      data-testid="terminal-keys-panel"
    >
      <div className="flex h-7 shrink-0 items-center justify-end px-0.5">
        <button
          type="button"
          aria-label="Hide keys panel"
          onClick={onCollapse}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          data-testid="terminal-keys-collapse"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-0.5 pt-0 md:p-1.5 md:pt-0">
        <div className="grid grid-cols-3 gap-1">
          {modifier(ctrl, () => setCtrl((on) => !on), "ctrl", "terminal-key-ctrl")}
          {modifier(alt, () => setAlt((on) => !on), "alt", "terminal-key-alt")}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {NAV_KEYS.map((key) => (
            <KeyButton key={key.testid} spec={key} onPress={() => press(key)} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {CONTROL_KEYS.map((key) => (
            <KeyButton key={key.testid} spec={key} onPress={() => press(key)} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {SYMBOL_KEYS.map((key) => (
            <KeyButton key={key.testid} spec={key} onPress={() => press(key)} />
          ))}
          <button
            type="button"
            aria-label="Paste from your clipboard"
            onMouseDown={keepFocus}
            onClick={() => void paste()}
            className={keyClass}
            data-testid="terminal-key-paste"
          >
            <Clipboard className="size-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
