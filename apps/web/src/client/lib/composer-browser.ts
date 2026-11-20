export const chatDraftKey = (botId: string) => `tiny-agents:draft:${botId}`;
export const codeDraftKey = (key: string) => `tiny-agents:code-draft:${key}`;

const MENTION_TIP_KEY = "tiny-agents:mention-tip-seen";

export function readStoredDraft(storageKey: string): string {
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredDraft(storageKey: string, text: string): void {
  try {
    if (text) localStorage.setItem(storageKey, text);
    else localStorage.removeItem(storageKey);
  } catch {}
}

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
  } catch {}
}

export function prefersCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
