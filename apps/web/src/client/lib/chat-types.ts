/** Chat stream shapes shared by the SSE client and the UI. Mirrors
 * `@tiny-agents/agent` ChatEvent/ChatState (server sends them verbatim).
 * Client-only additions live here: `connected`, `loaded`, `pending`,
 * `unreadFrom`, and the routine run cards (`routineRuns`). */
import type {
  ChatCredentialRequest,
  ChatVaultUse,
  OwnerAnswer,
  OwnerQuestion,
} from "@tiny-agents/agent";

export type { ChatCredentialRequest, ChatVaultUse, OwnerAnswer, OwnerQuestion };

export type ChatMessageStatus = "done" | "streaming" | "stopped" | "error" | "unanswered";

export type ChatToolStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_answer"
  | "awaiting_credentials"
  | "awaiting_takeover"
  | "done"
  | "error"
  | "denied"
  | "expired"
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
  /** Time the call waited for the owner's approval (not part of durationMs). */
  waitedMs?: number;
  taskId?: number;
  /** `auto`: auto-review approved the call, no card was shown; `refused`: nobody was there to ask. */
  approval?: "approved" | "denied" | "auto" | "refused";
  sources?: { url: string; title: string }[];
  /** `shelley_start` calls (issue #143): the Shelley conversation it started. */
  shelley?: { conversationId: string; slug: string | null; cwd: string | null; url: string };
  /** ask_owner calls: the questions the bot asked. */
  questions?: OwnerQuestion[];
  /** ask_owner calls: the owner's answers; absent while waiting and once dismissed. */
  answers?: OwnerAnswer[];
  /** Epoch ms after which a pending approval or credential request expires. */
  expiresAt?: number;
  /** Vault sinks (issue #56): what the approval card shows, never a value. */
  vault?: ChatVaultUse;
  /** request_credentials calls: the sheet's form and which keys were filled. */
  credentials?: ChatCredentialRequest;
  /** computer_request_takeover calls (issue #108): what the bot asked the owner to do. */
  takeover?: { status: "pending" | "released" | "expired"; reason: string };
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
  /** The send's request id (every owner send records one; older entries may lack it). */
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

/** An Echo: the optimistic copy of an owner send, shown until the server confirms it. */
export interface PendingMessage {
  /**
   * The send's request id, minted once by the owner-send module
   * (store/owner-send.ts) and reused by every retry of the same message.
   */
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

/**
 * A finished routine run, shown as a quiet line in its bot's chat (issue
 * #63) when it finished in the current thread. The run itself happened in
 * the routine's own conversation: the line is not a transcript entry and the
 * bot never reads it. Mirrors the server's `RoutineRunCard` (routines.cards.ts).
 */
export interface RoutineRunCard {
  id: string;
  routineId: string;
  routineName: string;
  /** `blocked`: it finished but could not do its job; `error` says why (issue #87). */
  status: "succeeded" | "blocked" | "failed" | "missed" | "cancelled";
  trigger: "schedule" | "manual";
  scheduledFor: string;
  finishedAt: string;
  output: string | null;
  error: string | null;
}

export interface ChatState {
  messages: ChatMessage[];
  /** Finished routine runs of this bot, oldest first: merged into the timeline by time. */
  routineRuns: RoutineRunCard[];
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
  /** Older messages exist above `messages[0]`; they load on scroll (issue #92). */
  hasMore?: boolean;
  /** A page of older messages is being fetched. */
  loadingOlder?: boolean;
  /**
   * Pre-open read marker (epoch ms), seeded once when the chat connects and
   * never advanced: messages newer than it arrived while the owner was away.
   * Drives the WhatsApp-style "new messages" divider (issue #3).
   */
  unreadFrom: number | null;
}

export type ActivityEvent =
  | { type: "activity"; busy: string[] }
  | {
      type: "activity";
      conversation: string;
      busy: boolean;
      approvals?: number;
      questions?: number;
    };

export type ChatEvent =
  | { type: "snapshot"; state: ChatState }
  | { type: "upsert"; message: ChatMessage }
  | { type: "remove"; id: string }
  | { type: "delta"; id: string; text?: string; reasoning?: string }
  | { type: "queued"; items: QueuedMessage[] }
  | { type: "busy"; busy: boolean }
  | { type: "routine-runs"; runs: RoutineRunCard[] }
  | { type: "routine-run"; run: RoutineRunCard }
  | ActivityEvent
  | { type: "connection"; id: string; status: string; error?: string }
  | { type: "ping" }
  | { type: "error"; message: string }
  | { type: "pending-add"; message: PendingMessage }
  | { type: "pending-remove"; id: string }
  | { type: "connected"; connected: boolean };
