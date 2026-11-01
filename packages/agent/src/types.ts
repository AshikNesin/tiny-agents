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
  | "awaiting_answer"
  | "done"
  | "error"
  | "awaiting_credentials"
  | "awaiting_takeover"
  | "denied"
  | "expired"
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
  /** Time the call waited for the owner's approval (not part of durationMs). */
  waitedMs?: number;
  /** Durable tool task id: what approval decisions address. */
  taskId?: number;
  /**
   * Set once the owner answered an approval for this call; `auto`: auto-review
   * approved it; `refused`: it would have asked in a conversation nobody watches.
   */
  approval?: "approved" | "denied" | "auto" | "refused";
  /** Epoch ms after which a pending approval or credential request expires. */
  expiresAt?: number;
  /** Vault sinks: the item and target the approval card shows (never a value). */
  vault?: ChatVaultUse;
  /** `request_credentials` calls: the form the owner fills, and which keys were filled. */
  credentials?: ChatCredentialRequest;
  /** `computer_request_takeover` calls: what the bot asked the owner to do on the computer. */
  takeover?: { status: "pending" | "released" | "expired"; reason: string };
  /** Pages the call searched or read (web tools). */
  sources?: { url: string; title: string }[];
  /** `ask_owner` calls: the questions the bot asked the owner. */
  questions?: OwnerQuestion[];
  /**
   * `ask_owner` calls: the owner's answers, one per question. Absent while the
   * call waits, and when the owner dismissed the questions.
   */
  answers?: OwnerAnswer[];
}

/** A vault use as its approval card shows it (issue #56). */
export interface ChatVaultUse {
  handle: string;
  label: string;
  kind: "login" | "card" | "identity" | "api_key";
  tool: string;
  target: string;
  bot?: string;
  card?: { brand: string; last4: string };
  username?: string;
  /** "Approve for this conversation" is offered. */
  grantable: boolean;
  /** `run_command`: the env vars the secrets go into. */
  env?: string[];
  /** `run_command`: everything the confined command may connect to. */
  hosts?: string[];
}

/** A `request_credentials` call as the chat shows it: metadata only. */
export interface ChatCredentialRequest {
  status: "pending" | "filled" | "cancelled" | "expired";
  origin: string;
  title: string;
  purpose: string;
  fields: { key: string; label: string; type: string; required: boolean }[];
  /** Keys the server filled. */
  filled?: string[];
  savedHandle?: string;
}

/** One question a bot asks the owner (`ask_owner`). */
export interface OwnerQuestion {
  question: string;
  /** Context shown under the question. */
  description?: string;
  /** Answers to pick from; none: an open question, answered in the owner's own words. */
  options?: { label: string; description?: string }[];
  /** The owner may pick several options. */
  multiple?: boolean;
}

/** The owner's answer to one question: options they picked and/or their own words. Both empty: skipped. */
export interface OwnerAnswer {
  selected: string[];
  text?: string;
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
  /** Files only: extraction state when the ref was made (issue #58; live state via the upload). */
  status?: "none" | "pending" | "ready" | "failed" | "unsupported";
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
  /**
   * Windowed states only (a chat stream's snapshot, issue #92): older
   * messages exist before `messages[0]`, fetched with `readChatPage`.
   */
  hasMore?: boolean;
  /** Windowed states only: the oldest message id in the window. */
  cursor?: string;
}

/** A page of older messages (see `AgentRuntime.readChatPage`), oldest first. */
export interface ChatPage {
  messages: ChatMessage[];
  /** Still older messages exist before `messages[0]`. */
  hasMore: boolean;
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
  /** `ask_owner` calls waiting for the owner's answers. */
  questions: number;
}

/**
 * A tool call starting or stopping to wait on the owner (see
 * `AgentRuntime.onWait`). Calls re-run after a restart are added again.
 */
export interface WaitEvent {
  kind: "approval" | "question";
  change: "added" | "removed";
  conversation: ConversationRef;
  /** The waiting call's task id (what the approval/questions routes take). */
  task: number;
  /** The tool that waits (added only). */
  tool?: string;
  /** Owner-facing text such as the first question (added only; untrusted model text). */
  preview?: string;
  /** What a vault call wants to use or a credential request wants (added only). */
  subject?: string;
  /** Epoch ms when the wait expires, for calls that expire (added only). */
  expiresAt?: number;
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
  /** Tools this message called that were refused for want of an approval (unattended runs). */
  refused?: string[];
  /** The reason this message's `report_routine_blocked` call gave (routine runs, issue #87). */
  blocked?: string;
}

/** Result of withdrawing a message by its request id (see `AgentRuntime.withdraw`). */
export type WithdrawOutcome = "withdrawn" | "already_placed" | "settled" | "not_found";

export interface ChatSubscription {
  /** State at attach time (also delivered as the first `snapshot` event). */
  readonly initial: ChatState;
  stop(): Promise<void>;
}
