/** Chat stream shapes shared by the SSE client and the UI. Mirrors
 * `@tiny-agents/agent` ChatEvent/ChatState (server sends them verbatim). */
export type ChatMessageStatus = "done" | "streaming" | "stopped" | "error" | "unanswered";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "marker";
  text: string;
  reasoning?: string;
  status: ChatMessageStatus;
  error?: string;
  model?: string;
  createdAt: number;
  marker?: "compaction";
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
}

export type ChatEvent =
  | { type: "snapshot"; state: ChatState }
  | { type: "upsert"; message: ChatMessage }
  | { type: "remove"; id: string }
  | { type: "delta"; id: string; text?: string; reasoning?: string }
  | { type: "busy"; busy: boolean }
  | { type: "activity"; busy?: boolean; conversation?: string }
  | { type: "ping" }
  | { type: "error"; message: string };
