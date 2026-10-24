/**
 * App-shaped types exposed by @tiny-agents/agent. Nothing here references
 * pi-durable, so the rest of the app never depends on its (experimental) API.
 */

import type { CapabilitySelection } from "./capabilities";

/** Opaque id of a durable conversation (pi-durable's numeric conversation id). */
export type ConversationRef = number;

export interface ModelInfo {
  id: string;
  name: string;
  /** Upstream family, derived from the id: "anthropic", "openai" or "workers-ai". */
  family: "anthropic" | "openai" | "workers-ai" | "other";
  reasoning: boolean;
  contextWindow: number;
  /** The model accepts image content natively. */
  vision: boolean;
}

export interface BotAgentConfig {
  /** Persona / system prompt. Empty string means none. */
  systemPrompt: string;
  /** Model id from the gateway catalog. */
  modelId: string;
  /**
   * Capabilities the bot may use and per-tool permissions. Omitted: leave the
   * conversation's tool selection unchanged (every installed extension).
   */
  capabilities?: CapabilitySelection;
}

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

/** One tool call of an assistant turn, with its live status or result. */
export interface ChatToolCall {
  /** Provider call id (unique within its message only; may be empty). */
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ChatToolStatus;
  /** Result text for the user (bounded). */
  output?: string;
  durationMs?: number;
  /** Durable tool task id: what approval decisions address. */
  taskId?: number;
  /** Set once the owner answered an approval for this call. */
  approval?: "approved" | "denied";
  /** Pages the call searched or read (web tools). */
  sources?: { url: string; title: string }[];
}

/** An image or file attached to a user message (issue #17). */
export interface AttachmentRef {
  /** Upload row id; resolves bytes through /api/v1/uploads/:id/content. */
  uploadId: string;
  kind: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  /** Images only, after preparation. */
  width?: number;
  height?: number;
}

export interface ChatMessage {
  /** Stable id: `e<entryId>` for committed entries, `live` for the in-flight reply. */
  id: string;
  role: "user" | "assistant" | "marker";
  text: string;
  /** Attachments the user sent with this message (user role only). */
  attachments?: AttachmentRef[];
  /**
   * The `submit` request id, when the entry recorded one (user role only:
   * sends with attachments or peer attribution). The server may annotate
   * such a message's text, so clients confirm their optimistic echo by this
   * id rather than by text.
   */
  requestId?: string;
  /**
   * Trusted attribution for a cross-bot delivery (user role only): set by
   * the delivery pipeline, never by the owner's composer. A text that merely
   * looks like an envelope has no `peer` and renders as a plain bubble —
   * the parser alone must never attribute a card (cubic: spoofing).
   */
  peer?:
    | { kind: "reply"; name: string }
    | { kind: "message"; name: string }
    | { kind: "mention"; hostName: string };
  /** Tool calls this assistant turn made, in order. */
  toolCalls?: ChatToolCall[];
  /** Model thinking, when the model emitted any. */
  reasoning?: string;
  status: ChatMessageStatus;
  /** Error / failure detail for `error` and `unanswered`. */
  error?: string;
  /** Model id that produced an assistant message. */
  model?: string;
  /** Milliseconds since epoch. */
  createdAt: number;
  /** For markers: what happened. */
  marker?: "compaction";
}

/**
 * An input durably queued while the conversation is busy: a steer joins the
 * running reply after its current tool round; a follow-up starts the next one.
 * Owner messages only — cross-bot deliveries (peer entries) never queue here.
 */
export interface QueuedMessage {
  /** Host request id: what withdrawal (the transcript's cancel) addresses. */
  requestId: string;
  mode: "steer" | "followUp";
  /** Message text (image blocks are flattened to their notes server-side). */
  text: string;
  /** Attachments the message carries (issue #17). */
  attachments?: AttachmentRef[];
}

export interface ChatState {
  messages: ChatMessage[];
  /** A reply is being generated (or queued work is running). */
  busy: boolean;
  /** Owner inputs waiting behind (or steering into) the running reply. */
  readonly queued: readonly QueuedMessage[];
}

export type ChatEvent =
  | { type: "snapshot"; state: ChatState }
  | { type: "upsert"; message: ChatMessage }
  | { type: "remove"; id: string }
  | { type: "delta"; id: string; text?: string; reasoning?: string }
  | { type: "queued"; items: readonly QueuedMessage[] }
  | { type: "busy"; busy: boolean };

export interface ActivityChange {
  conversation: ConversationRef;
  busy: boolean;
  /** Tool calls waiting for the owner's approval. */
  approvals: number;
}

export interface LastMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

/** An assistant reply that finished (see `AgentRuntime.finishedReplies`). */
export interface FinishedReply {
  /** The reply's text; often empty when it ended in a model error. */
  text: string;
  createdAt: number;
  /** Set when the reply ended in a model error: the provider's message. */
  error?: string;
}

/** Result of withdrawing a message by its request id (see `AgentRuntime.withdraw`). */
export type WithdrawOutcome = "withdrawn" | "already_placed" | "settled" | "not_found";

export interface ChatSubscription {
  /** State at attach time (also delivered as the first `snapshot` event). */
  readonly initial: ChatState;
  stop(): Promise<void>;
}
