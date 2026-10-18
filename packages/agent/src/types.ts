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

export interface ChatMessage {
  /** Stable id: `e<entryId>` for committed entries, `live` for the in-flight reply. */
  id: string;
  role: "user" | "assistant" | "marker";
  text: string;
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

export interface ChatState {
  messages: ChatMessage[];
  /** A reply is being generated (or queued work is running). */
  busy: boolean;
}

export type ChatEvent =
  | { type: "snapshot"; state: ChatState }
  | { type: "upsert"; message: ChatMessage }
  | { type: "remove"; id: string }
  | { type: "delta"; id: string; text?: string; reasoning?: string }
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

export interface ChatSubscription {
  /** State at attach time (also delivered as the first `snapshot` event). */
  readonly initial: ChatState;
  stop(): Promise<void>;
}
