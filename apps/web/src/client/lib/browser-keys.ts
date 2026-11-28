export interface KeyStroke {
  keysym: number;
  code: string;
  down: boolean;
}

const KEYSYMS = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
} as const;

const SHIFT_L = 0xffe1;
const CONTROL_L = 0xffe3;
const ALT_L = 0xffe9;

export function keysymFor(key: string): number | undefined {
  if (key in KEYSYMS) return KEYSYMS[key as keyof typeof KEYSYMS];
  const chars = [...key];
  if (chars.length !== 1) return undefined;
  const cp = chars[0]!.codePointAt(0)!;
  return cp < 0x100 ? cp : 0x01000000 + cp;
}

interface ChordEvent {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
}

function baseKey(event: ChordEvent): string {
  if (event.code.startsWith("Key")) return event.code.slice(3).toLowerCase();
  if (event.code.startsWith("Digit")) return event.code.slice(5);
  return event.key;
}

export function remapMetaChord(event: ChordEvent): KeyStroke[] | null {
  let key = baseKey(event);
  let ctrl = true;
  switch (event.key) {
    case "ArrowLeft":
      key = "Home";
      ctrl = false;
      break;
    case "ArrowRight":
      key = "End";
      ctrl = false;
      break;
    case "ArrowUp":
      key = "Home";
      break;
    case "ArrowDown":
      key = "End";
      break;
  }
  const keysym = keysymFor(key);
  if (keysym === undefined) return null;

  const modifiers: KeyStroke[] = [];
  if (event.shiftKey) modifiers.push({ keysym: SHIFT_L, code: "ShiftLeft", down: true });
  if (event.altKey) modifiers.push({ keysym: ALT_L, code: "AltLeft", down: true });
  if (ctrl) modifiers.push({ keysym: CONTROL_L, code: "ControlLeft", down: true });

  const release = modifiers.map((m) => ({ ...m, down: false })).reverse();
  return [
    ...modifiers,
    { keysym, code: event.code, down: true },
    { keysym, code: event.code, down: false },
    ...release,
  ];
}
