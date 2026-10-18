/** Chat stream shapes shared by the SSE client and the UI. Mirrors
 * `@tiny-agents/agent` ChatEvent/ChatState (server sends them verbatim). */
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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "marker";
  text: string;
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
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  /** Locally echoed messages not yet confirmed by the server snapshot. */
  pending: PendingMessage[];
  /** False while the SSE stream is down (backend restart, network drop). */
  connected: boolean;
}

export type ChatEvent =
  | { type: "snapshot"; state: ChatState }
  | { type: "upsert"; message: ChatMessage }
  | { type: "remove"; id: string }
  | { type: "delta"; id: string; text?: string; reasoning?: string }
  | { type: "busy"; busy: boolean }
  | { type: "activity"; busy?: boolean; conversation?: string; approvals?: number }
  | { type: "connection"; id: string; status: string; error?: string }
  | { type: "ping" }
  | { type: "error"; message: string }
  | { type: "pending-add"; message: PendingMessage }
  | { type: "pending-remove"; id: string }
  | { type: "connected"; connected: boolean };
