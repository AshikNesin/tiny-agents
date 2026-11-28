import { toast } from "sonner";

export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && (await clipboardTook(text))) return true;
  return legacyCopy(text);
}

async function clipboardTook(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    ignoreClipboardRefusal(error);
    return false;
  }
}

export function ignoreClipboardRefusal(error: unknown): void {
  if (error instanceof DOMException && error.name === "NotAllowedError") return;
  console.warn("The clipboard failed for a reason other than a refusal", error);
}

export function sayClipboardReadRefused(error: unknown): void {
  ignoreClipboardRefusal(error);
  toast.error("Could not read the clipboard. Allow clipboard access and try again.");
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
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
  active?.focus?.({ preventScroll: true });
  return copied;
}

export type ClipboardReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "unavailable" | "denied" };

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
