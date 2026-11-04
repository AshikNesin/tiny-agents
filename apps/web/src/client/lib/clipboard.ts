/**
 * Clipboard access that degrades instead of failing. `navigator.clipboard`
 * only exists in secure contexts, and the app is often reached over plain
 * http (a tailnet IP, a LAN box), where it is undefined. Writes then fall
 * back to the old hidden-textarea `execCommand("copy")`, which still works
 * inside a user gesture. Reads have no such fallback: the browser's own
 * paste event (Ctrl/Cmd+V) is the only way in there, and callers say so.
 */

/** Copy `text`; resolves false when every route was refused. */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or no user activation: try the legacy route.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Off-screen but focusable; a fixed position keeps the page from scrolling.
  area.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  // Give the terminal its caret back.
  active?.focus?.({ preventScroll: true });
  return copied;
}

/** Why a programmatic read failed, so the caller can say what to do instead. */
export type ClipboardReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "unavailable" | "denied" };

/** Read the clipboard (asks permission the first time in Chromium). */
export async function readClipboardText(): Promise<ClipboardReadResult> {
  if (!window.isSecureContext || !navigator.clipboard?.readText) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    return { ok: true, text: await navigator.clipboard.readText() };
  } catch {
    return { ok: false, reason: "denied" };
  }
}

/** The platform's paste chord, for hints ("Press ⌘V to paste"). */
export function pasteShortcut(): string {
  return isMac() ? "⌘V" : "Ctrl+V";
}

export function isMac(): boolean {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
