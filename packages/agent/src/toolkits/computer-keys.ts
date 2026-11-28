import type { KeyModifier } from "@tiny-agents/sandbox/computer";

const MODIFIERS: Record<string, KeyModifier> = {
  ctrl: "ctrl",
  control: "ctrl",
  shift: "shift",
  alt: "alt",
  option: "alt",
  super: "super",
  cmd: "super",
  command: "super",
  meta: "super",
  win: "super",
};

const KEY_ALIASES: Record<string, string> = {
  enter: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  space: "space",
  backspace: "BackSpace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "Page_Up",
  page_up: "Page_Up",
  pagedown: "Page_Down",
  page_down: "Page_Down",
  menu: "Menu",
  print: "Print",
};

const CLOSING_CHORDS = new Set([
  "alt+f4",
  "ctrl+q",
  "ctrl+w",
  "ctrl+shift+q",
  "ctrl+shift+w",
  "alt+ctrl+delete",
  "alt+ctrl+backspace",
]);

const MODIFIER_ORDER: KeyModifier[] = ["alt", "ctrl", "shift", "super"];

export function normalizeKeys(keys: string): { chords: string[]; closing: boolean } {
  const parts = keys.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error("Name at least one key, e.g. ctrl+s or Return.");
  if (parts.length > 16) throw new Error("At most 16 key presses per call.");
  let closing = false;
  const chords = parts.map((part) => {
    const tokens = part.split("+");
    const keyToken = tokens.pop() ?? "";
    const modifiers = new Set<KeyModifier>();
    for (const token of tokens) {
      const modifier = MODIFIERS[token.toLowerCase()];
      if (!modifier) throw new Error(`Not a modifier: ${token} (use ctrl, shift, alt or super).`);
      modifiers.add(modifier);
    }
    let key = keyToken;
    if (MODIFIERS[key.toLowerCase()] && tokens.length === 0) key = MODIFIERS[key.toLowerCase()];
    else if (KEY_ALIASES[key.toLowerCase()]) key = KEY_ALIASES[key.toLowerCase()];
    else if (/^f([1-9]|1[0-2])$/i.test(key)) key = key.toUpperCase();
    if (!/^[A-Za-z0-9_]{1,32}$/.test(key)) {
      throw new Error(`Not a key name: ${keyToken}. Use xdotool names like Return, Tab, a, F5.`);
    }
    const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m));
    if (CLOSING_CHORDS.has([...ordered, key.toLowerCase()].join("+"))) closing = true;
    return [...ordered, key].join("+");
  });
  return { chords, closing };
}
