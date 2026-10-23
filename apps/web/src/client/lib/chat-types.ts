/** Chat stream shapes shared by the SSE client and the UI. Mirrors
 * `@tiny-agents/agent` ChatEvent/ChatState (server sends them verbatim).
 * Client-only additions live here: `connected`, `loaded`, `pending`, `unreadFrom`. */
export type ChatMessageStatus = "done" | "streaming" | "stopped" | "error" | "unanswered";

export type ChatToolStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "done"
  | "error"
  | "denied"
  | "interrupted"
  | "aborted";

/** One tool call of an assistant turn (issue #1): live status or result. */
export interface ChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ChatToolStatus;
  output?: string;
  durationMs?: number;
  taskId?: number;
  approval?: "approved" | "denied";
  sources?: { url: string; title: string }[];
}

export interface AttachmentRef {
  uploadId: string;
  kind: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "marker";
  text: string;
  /** Attachments the user sent with this message (issue #17). */
  attachments?: AttachmentRef[];
  /** The send's request id, when the server recorded one (attachment and peer sends). */
  requestId?: string;
  /** Trusted cross-bot attribution (delivery pipeline only; renders as a card). */
  peer?: import("@tiny-agents/agent").ChatMessage["peer"];
  /** Tool calls this assistant turn made, in order. */
  toolCalls?: ChatToolCall[];
  reasoning?: string;
  status: ChatMessageStatus;
  error?: string;
  model?: string;
  createdAt: number;
  marker?: "compaction";
}

export interface PendingMessage {
  /** Client-generated id (crypto.randomUUID), stable across retries. */
  id: string;
  text: string;
  createdAt: number;
  /** Attachment refs echoed optimistically (issue #17). */
  attachments?: AttachmentRef[];
}

/**
 * An input the server holds while the bot is replying: a steer joins the
 * running reply, a follow-up starts the next one. Mirrors the agent package's
 * QueuedMessage (the queued SSE event carries it verbatim).
 */
export interface QueuedMessage {
  /** The send's request id: what withdrawal (the bubble's x) addresses. */
  requestId: string;
  mode: "steer" | "followUp";
  text: string;
  attachments?: AttachmentRef[];
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  /** Owner inputs the server holds behind (or steering into) the reply. */
  queued: QueuedMessage[];
  /** Locally echoed messages not yet confirmed by the server snapshot. */
  pending: PendingMessage[];
  /** False while the SSE stream is down (backend restart, network drop). */
  connected: boolean;
  /**
   * True once the first snapshot arrived. Until then the transcript is
   * unknown, not empty: the pane must not flash the empty state or a
   * "Reconnecting…" notice while the very first connection opens.
   */
  loaded: boolean;
  /**
   * Pre-open read marker (epoch ms), seeded once when the chat connects and
   * never advanced: messages newer than it arrived while the owner was away.
   * Drives the WhatsApp-style "new messages" divider (issue #3).
   */
  unreadFrom: number | null;
}

export type ActivityEvent =
  | { type: "activity"; busy: string[] }
  | { type: "activity"; conversation: string; busy: boolean; approvals?: number };

export type ChatEvent =
  | { type: "snapshot"; state: ChatState }
  | { type: "upsert"; message: ChatMessage }
  | { type: "remove"; id: string }
  | { type: "delta"; id: string; text?: string; reasoning?: string }
  | { type: "queued"; items: QueuedMessage[] }
  | { type: "busy"; busy: boolean }
  | ActivityEvent
  | { type: "connection"; id: string; status: string; error?: string }
  | { type: "ping" }
  | { type: "error"; message: string }
  | { type: "pending-add"; message: PendingMessage }
  | { type: "pending-remove"; id: string }
  | { type: "connected"; connected: boolean };
