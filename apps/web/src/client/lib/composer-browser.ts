import { readStored, writeStored } from "./browser-storage";

export const chatDraftKey = (botId: string) => `tiny-agents:draft:${botId}`;
export const codeDraftKey = (key: string) => `tiny-agents:code-draft:${key}`;

const MENTION_TIP_KEY = "tiny-agents:mention-tip-seen";

export function mentionTipSeen(): boolean {
  return readStored(MENTION_TIP_KEY) === "1";
}

export function markMentionTipSeen(): void {
  writeStored(MENTION_TIP_KEY, "1");
}

export function prefersCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}
