import type { KeyStroke } from "./browser-keys";

const KEY = {
  Control: { keysym: 0xffe3, code: "ControlLeft" },
  Alt: { keysym: 0xffe9, code: "AltLeft" },
  Super: { keysym: 0xffeb, code: "MetaLeft" },
  Tab: { keysym: 0xff09, code: "Tab" },
  Escape: { keysym: 0xff1b, code: "Escape" },
  F1: { keysym: 0xffbe, code: "F1" },
  F2: { keysym: 0xffbf, code: "F2" },
  F4: { keysym: 0xffc1, code: "F4" },
  t: { keysym: 0x74, code: "KeyT" },
  w: { keysym: 0x77, code: "KeyW" },
} as const;

type KeyName = keyof typeof KEY;

function chord(...keys: KeyName[]): KeyStroke[] {
  return [
    ...keys.map((key) => ({ ...KEY[key], down: true })),
    ...[...keys].reverse().map((key) => ({ ...KEY[key], down: false })),
  ];
}

export interface DesktopShortcut {
  label: string;
  keys: string;
  strokes: KeyStroke[];
}

export const DESKTOP_SHORTCUTS: DesktopShortcut[] = [
  { label: "Applications menu", keys: "Alt+F1", strokes: chord("Alt", "F1") },
  { label: "Run a program", keys: "Alt+F2", strokes: chord("Alt", "F2") },
  { label: "Open a terminal", keys: "Ctrl+Alt+T", strokes: chord("Control", "Alt", "t") },
  { label: "Switch windows", keys: "Alt+Tab", strokes: chord("Alt", "Tab") },
  { label: "Close window", keys: "Alt+F4", strokes: chord("Alt", "F4") },
  { label: "Close tab", keys: "Ctrl+W", strokes: chord("Control", "w") },
  { label: "Escape", keys: "Esc", strokes: chord("Escape") },
  { label: "Super", keys: "Super", strokes: chord("Super") },
];
