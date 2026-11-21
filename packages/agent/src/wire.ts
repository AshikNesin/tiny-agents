import type { ChatMessage } from "./types";

export const SKIP_REPLY = "[skip]";

export const MAX_ANSWER_TEXT = 2_000;

export function isSkipReply(message: Pick<ChatMessage, "role" | "text" | "toolCalls">): boolean {
  return (
    message.role === "assistant" &&
    message.text.trim() === SKIP_REPLY &&
    (message.toolCalls?.length ?? 0) === 0
  );
}
