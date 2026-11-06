/**
 * What a composer reads from the browser: the unsent draft kept in this
 * browser, the one-time @ tip, and whether the primary pointer is touch.
 * Storage can be unavailable (private mode, blocked site data), so every
 * access is best-effort: losing a draft or seeing the tip again is fine.
 */

/** A bot chat's draft, per bot. */
export const chatDraftKey = (botId: string) => `tiny-agents:draft:${botId}`;
/** A Code draft, per thread (or "new:<harness>"). */
export const codeDraftKey = (key: string) => `tiny-agents:code-draft:${key}`;

const MENTION_TIP_KEY = "tiny-agents:mention-tip-seen";

/** The unsent text kept under `storageKey`, or "". */
export function readStoredDraft(storageKey: string): string {
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

/** Keep the unsent text (an empty draft removes the entry). */
export function writeStoredDraft(storageKey: string, text: string): void {
  try {
    if (text) localStorage.setItem(storageKey, text);
    else localStorage.removeItem(storageKey);
  } catch {
    // Drafts are a convenience; losing one is fine.
  }
}

/** Whether the owner has used a mention (blocked storage counts as seen). */
export function mentionTipSeen(): boolean {
  try {
    return localStorage.getItem(MENTION_TIP_KEY) === "1";
  } catch {
    return true;
  }
}

export function markMentionTipSeen(): void {
  try {
    localStorage.setItem(MENTION_TIP_KEY, "1");
  } catch {
    // Storage blocked: the tip just shows again next time.
  }
}

/**
 * Primary-pointer media query (pointer: coarse = touch, e.g. phones and
 * tablets). On such devices Enter inserts a newline and only the send
 * button sends — Enter-to-send is a physical-keyboard affordance (issue #1).
 */
export function prefersCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
