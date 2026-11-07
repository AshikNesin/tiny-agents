/**
 * The chat's wire shapes, for the stream client and the UI. They are the
 * agent package's own types (the server sends them verbatim) and the bot
 * stream's contract (shared/bot-stream.ts): nothing here is a copy. What
 * only the browser knows (Echoes, stream health, the unread divider) lives
 * in the chat session (lib/chat-session.ts), never in these.
 */
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

/**
 * A shared chat's silent reply: the bot decided the message was not for it.
 * The agent package's `SKIP_REPLY`, restated because its module is not
 * browser-safe (only types cross from it).
 */
export const SKIP_REPLY = "[skip]";

export function isSkipReply(message: Pick<ChatMessage, "role" | "text" | "toolCalls">): boolean {
  return (
    message.role === "assistant" &&
    message.text.trim() === SKIP_REPLY &&
    (message.toolCalls?.length ?? 0) === 0
  );
}
