import type { ChatMessage } from "@tiny-agents/agent";

export type {
  AttachmentRef,
  ChatAuthor,
  ChatMessage,
  ChatPage,
  ChatToolCall,
  ChatToolStatus,
  OwnerAnswer,
  OwnerQuestion,
  QueuedMessage,
} from "@tiny-agents/agent";
export type { BotStreamEvent, EventsFeedEvent, RoutineRunCard } from "../../shared/bot-stream";

export const SKIP_REPLY = "[skip]";

export function isSkipReply(message: Pick<ChatMessage, "role" | "text" | "toolCalls">): boolean {
  return (
    message.role === "assistant" &&
    message.text.trim() === SKIP_REPLY &&
    (message.toolCalls?.length ?? 0) === 0
  );
}
