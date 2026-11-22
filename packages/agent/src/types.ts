import type { CapabilitySelection } from "./capabilities";

export type ConversationRef = number;

export interface BotAgentConfig {
  systemPrompt: string;
  modelId: string;
  capabilities?: CapabilitySelection;
  cwd?: string | null;
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

export interface ChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ChatToolStatus;
  output?: string;
  durationMs?: number;
  waitedMs?: number;
  taskId?: number;
  approval?: "approved" | "denied" | "auto" | "yolo" | "refused";
  limit?: RunLimit;
  exitCode?: number;
  diff?: { path: string; diff: string };
  expiresAt?: number;
  vault?: ChatVaultUse;
  credentials?: ChatCredentialRequest;
  takeover?: { status: "pending" | "released" | "expired"; reason: string };
  sources?: { url: string; title: string }[];
  code?: {
    threadId: string;
    harness: string;
    title: string | null;
    cwd: string | null;
    url: string;
  };
  questions?: OwnerQuestion[];
  answers?: OwnerAnswer[];
}

export interface ChatVaultUse {
  handle: string;
  label: string;
  kind: "login" | "card" | "identity" | "api_key";
  tool: string;
  target: string;
  bot?: string;
  card?: { brand: string; last4: string };
  username?: string;
  grantable: boolean;
  env?: string[];
  hosts?: string[];
}

export interface ChatCredentialRequest {
  status: "pending" | "filled" | "cancelled" | "expired";
  origin: string;
  title: string;
  purpose: string;
  fields: { key: string; label: string; type: string; required: boolean }[];
  filled?: string[];
  savedHandle?: string;
}

export interface OwnerQuestion {
  question: string;
  description?: string;
  options?: { label: string; description?: string }[];
  multiple?: boolean;
}

export interface OwnerAnswer {
  selected: string[];
  text?: string;
}

export interface AttachmentRef {
  uploadId: string;
  kind: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  status?: "none" | "pending" | "ready" | "failed" | "unsupported";
}

export interface ChatAuthor {
  id: number;
  name: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "marker";
  text: string;
  attachments?: AttachmentRef[];
  requestId?: string;
  peer?:
    | { kind: "reply"; name: string }
    | { kind: "message"; name: string }
    | { kind: "mention"; hostName: string };
  author?: ChatAuthor;
  toolCalls?: ChatToolCall[];
  reasoning?: string;
  status: ChatMessageStatus;
  error?: string;
  model?: string;
  createdAt: number;
  marker?: "compaction";
  quiet?: true;
  sent?: string[];
}

export interface QueuedMessage {
  requestId: string;
  mode: "steer" | "followUp";
  text: string;
  createdAt?: number;
  attachments?: AttachmentRef[];
  author?: ChatAuthor;
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  readonly queued: readonly QueuedMessage[];
  hasMore?: boolean;
  cursor?: string;
}

export interface ChatPage {
  messages: ChatMessage[];
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
  approvals: number;
  questions: number;
}

export interface WaitEvent {
  kind: "approval" | "question";
  change: "added" | "removed";
  conversation: ConversationRef;
  task: number;
  tool?: string;
  preview?: string;
  subject?: string;
  expiresAt?: number;
  vault?: { grantable: boolean };
}

export interface LastMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: number;
}

export interface FinishedReply {
  text: string;
  createdAt: number;
  error?: string;
  refused?: string[];
  blocked?: string;
  stoppedBy?: RunLimit;
  sent?: string[];
}

export type RunLimit = "budget" | "runCap";

export type WithdrawOutcome = "withdrawn" | "already_placed" | "settled" | "not_found";

export interface ChatSubscription {
  readonly initial: ChatState;
  stop(): Promise<void>;
}
