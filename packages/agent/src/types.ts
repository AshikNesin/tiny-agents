/**
 * App-shaped types exposed by @tiny-agents/agent. Nothing here references
 * pi-durable, so the rest of the app never depends on its (experimental) API.
 */

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
}

export type ChatMessageStatus = "done" | "streaming" | "stopped" | "error" | "unanswered";

export interface ChatMessage {
  /** Stable id: `e<entryId>` for committed entries, `live` for the in-flight reply. */
  id: string;
  role: "user" | "assistant" | "marker";
  text: string;
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
