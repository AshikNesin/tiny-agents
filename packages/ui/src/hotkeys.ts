"use client";

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";

export interface ParsedShortcut {
  mod: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

const MODIFIER_TOKENS: Record<string, keyof Omit<ParsedShortcut, "key">> = {
  mod: "mod",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  win: "meta",
  super: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  plus: "+",
};

function shortcutTokens(shortcut: string): string[] {
  const trimmed = shortcut.trim();
  if (trimmed === "") return [];
  const tokens = trimmed.split("+").map((t) => t.trim());
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "" && i > 0) {
      if (out[out.length - 1] !== "+") out.push("+");
      continue;
    }
    if (tokens[i] !== "") out.push(tokens[i]);
  }
  return out;
}

export function parseShortcut(shortcut: string): ParsedShortcut {
  const parsed: ParsedShortcut = {
    mod: false,
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
    key: "",
  };
  for (const token of shortcutTokens(shortcut)) {
    const lower = token.toLowerCase();
    const modifier = MODIFIER_TOKENS[lower];
    if (modifier) parsed[modifier] = true;
    else parsed.key = KEY_ALIASES[lower] ?? lower;
  }
  return parsed;
}

export function matchesShortcut(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  parsed: ParsedShortcut,
): boolean {
  if (parsed.key === "") return false;
  const key = e.key.toLowerCase();
  const byCode =
    parsed.key.length === 1 &&
    /[a-z0-9]/.test(parsed.key) &&
    (e.altKey || !/^[a-z0-9]$/i.test(e.key)) &&
    e.code.toLowerCase() === (/[a-z]/.test(parsed.key) ? `key${parsed.key}` : `digit${parsed.key}`);
  if (key !== parsed.key && !byCode) return false;
  if (parsed.mod) {
    if (!e.metaKey && !e.ctrlKey) return false;
  } else if (e.metaKey !== parsed.meta || e.ctrlKey !== parsed.ctrl) {
    return false;
  }
  if (e.altKey !== parsed.alt) return false;
  if (parsed.shift && !e.shiftKey) return false;
  return true;
}

export function hasModifier(parsed: ParsedShortcut): boolean {
  return parsed.mod || parsed.meta || parsed.ctrl || parsed.alt;
}

const CAP_LABELS: Record<string, { mac: string; other: string }> = {
  mod: { mac: "⌘", other: "Ctrl" },
  meta: { mac: "⌘", other: "Win" },
  ctrl: { mac: "⌃", other: "Ctrl" },
  alt: { mac: "⌥", other: "Alt" },
  shift: { mac: "⇧", other: "Shift" },
  enter: { mac: "↵", other: "Enter" },
  escape: { mac: "Esc", other: "Esc" },
  backspace: { mac: "⌫", other: "Backspace" },
  delete: { mac: "⌦", other: "Del" },
  tab: { mac: "⇥", other: "Tab" },
  " ": { mac: "Space", other: "Space" },
  arrowup: { mac: "↑", other: "↑" },
  arrowdown: { mac: "↓", other: "↓" },
  arrowleft: { mac: "←", other: "←" },
  arrowright: { mac: "→", other: "→" },
};

const PREFORMATTED = /^[⌘⌃⌥⇧↵⌫⌦⇥↑↓←→]+[A-Za-z0-9]?$/;

export function formatShortcut(shortcut: string, mac: boolean): string[] {
  const caps: string[] = [];
  for (const token of shortcutTokens(shortcut)) {
    if (PREFORMATTED.test(token)) {
      caps.push(...Array.from(token));
      continue;
    }
    const lower = token.toLowerCase();
    const modifier = MODIFIER_TOKENS[lower];
    const name = modifier ?? KEY_ALIASES[lower] ?? lower;
    const cap = CAP_LABELS[name];
    if (cap) caps.push(mac ? cap.mac : cap.other);
    else if (name.length === 1) caps.push(name.toUpperCase());
    else caps.push(name.charAt(0).toUpperCase() + name.slice(1));
  }
  return caps;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

let macPlatform: boolean | null = null;
const readMac = () => (macPlatform ??= isMacPlatform());
const serverMac = () => true;
const subscribeNever = () => () => {};

export function useIsMac(): boolean {
  return useSyncExternalStore(subscribeNever, readMac, serverMac);
}

export function isEditable(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLElement> | null;
  if (!el || typeof el.tagName !== "string") return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable === true
  );
}

const OPEN_DIALOG =
  '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [aria-modal="true"]:not([inert]), dialog[open]';

export function isDialogOpen(): boolean {
  if (bindings.some((b) => b.scope === "dialog" && b.isOpen())) return true;
  return typeof document !== "undefined" && document.querySelector(OPEN_DIALOG) !== null;
}

export type HotkeyScope = "global" | "dialog";

export interface HotkeyOptions {
  scope?: HotkeyScope;
  inFields?: boolean;
  open?: boolean;
  within?: RefObject<HTMLElement | null>;
  enabled?: boolean;
}

interface Binding {
  parsed: ParsedShortcut;
  scope: HotkeyScope;
  inFields: () => boolean;
  isOpen: () => boolean;
  inScope: () => boolean;
  fire: (e: KeyboardEvent) => void;
}

const bindings: Binding[] = [];

function pickBinding(hits: Binding[]): Binding | undefined {
  const closing = hits.find((b) => b.scope === "dialog" && b.isOpen());
  if (closing) return closing;
  if (isDialogOpen()) return undefined;
  const latestFirst = hits.slice().reverse();
  return (
    latestFirst.find((b) => b.scope === "dialog" && b.inScope()) ??
    latestFirst.find((b) => b.scope === "global" && b.inScope())
  );
}

function onKeyDown(e: KeyboardEvent) {
  if (e.repeat || e.defaultPrevented) return;
  const inField = isEditable(e.target);
  const hits = bindings.filter((b) => matchesShortcut(e, b.parsed) && (!inField || b.inFields()));
  if (hits.length === 0) return;
  const winner = pickBinding(hits);
  if (!winner) return;
  e.preventDefault();
  winner.fire(e);
}

function bind(binding: Binding): () => void {
  if (bindings.length === 0) window.addEventListener("keydown", onKeyDown);
  bindings.push(binding);
  return () => {
    const i = bindings.indexOf(binding);
    if (i !== -1) bindings.splice(i, 1);
    if (bindings.length === 0) window.removeEventListener("keydown", onKeyDown);
  };
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useHotkey(
  combo: string | null | undefined,
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const latest = useRef({ handler, options });
  useIsoLayoutEffect(() => {
    latest.current = { handler, options };
  });
  const scope = options.scope ?? "global";
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!combo || !enabled) return;
    const parsed = parseShortcut(combo);
    if (parsed.key === "") return;
    return bind({
      parsed,
      scope,
      inFields: () => latest.current.options.inFields ?? hasModifier(parsed),
      isOpen: () => latest.current.options.open ?? false,
      inScope: () => {
        const within = latest.current.options.within?.current;
        return !within || within.contains(document.activeElement);
      },
      fire: (e) => latest.current.handler(e),
    });
  }, [combo, scope, enabled]);
}
