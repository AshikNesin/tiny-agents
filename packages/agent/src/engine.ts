/**
 * Inference engine seam (ADR 0014). `pi` is the pi-durable harness
 * (default). `claude-code` sends turns to the Claude Code worker, which
 * drives the official Agent SDK. A model of a `claude-plan` provider
 * account selects it (issue #179). Both are `AgentEngine`s: the runtime picks one per conversation and
 * calls it, and calls nothing else on either; neither knows about the
 * other. What every conversation has whichever engine runs it is the
 * runtime's conversation store (`conversation-store.ts`); what only the
 * Claude plan has apart from conversations is `ClaudePlan`. Tool calls of
 * both go through the one Tool gate (`gate.ts`).
 */
import type { MaxTurns } from "@tiny-agents/claude-worker";
import type { AgentChange } from "@earendil-works/pi-durable";
import type { ClaudeSessionSync } from "./engines/claude-code/engine";
import type { GateUserMessage, Permissions } from "./policy";
import type {
  AgentEngineKind,
  AttachmentRef,
  ChatEvent,
  ChatMessage,
  ChatState,
  ChatSubscription,
  ConversationRef,
  WithdrawOutcome,
} from "./types";

export class ConversationNotFoundError extends Error {
  constructor(ref: ConversationRef) {
    super(`Conversation ${ref} not found`);
    this.name = "ConversationNotFoundError";
  }
}

/**
 * A bot's config compiled once by the runtime, for every engine to take its
 * part of: what pi-durable stores (also the stand-in a Claude plan
 * conversation falls back onto), the permissions the Tool gate reads, and
 * what the Claude plan runs with (set only when it runs the conversation).
 */
export interface CompiledConversation {
  change: AgentChange;
  /** The gate's `tiny.permissions`; absent: the conversation keeps its tools and runs everything. */
  permissions?: Permissions;
  claude?: ClaudeSessionSync;
}

/** A user message as the runtime hands it to an engine. */
export interface EngineSubmission {
  requestId: string;
  /** Plain text, or text plus inline image blocks. */
  text: string;
  images?: { data: string; mimeType: string }[];
  /** Attachment refs stored on the entry for the transcript (issue #17). */
  attachments?: AttachmentRef[];
  /** Trusted attribution for a cross-bot delivery (rendered as a card). */
  peer?: ChatMessage["peer"];
  /** Who sent it, in a shared chat (`text` already carries their name for the model). */
  author?: ChatMessage["author"];
  /** Placement while a reply runs: "steer" joins it (pi; the Claude plan queues it too), "followUp" (default) waits. */
  whenBusy?: "steer" | "followUp";
}

/**
 * One way of running a bot conversation's turns and keeping its transcript.
 * Per conversation: the runtime asks `runs(ref)` to pick the engine, then
 * calls only that one. Busy changes are reported through the callback the
 * engine was built with (pi's through the store's task graph); the runtime
 * merges them into the bot activity. This is everything the runtime calls
 * on an engine. It is wider than a turn runner: each engine still reads its
 * own entry family into the chat (`read`, `watch`, `userMessages`, C6).
 */
export interface AgentEngine {
  readonly kind: AgentEngineKind;
  /** Load what the engine keeps in the store, once at open, before `resume()`. */
  start(): Promise<void>;
  /**
   * Take the conversation's compiled config, after every create and
   * configure (the store has already kept its agent change and
   * permissions). An engine keeps what it runs with, and lets go of a
   * conversation the config no longer gives it.
   */
  configure(ref: ConversationRef, compiled: CompiledConversation): Promise<void>;
  /** Whether this engine runs the conversation's turns now. */
  runs(ref: ConversationRef): boolean;
  /**
   * Admit a user message. `unavailable`: the engine cannot run the turn, its
   * fallback is the gateway, and it has let go of the conversation for good;
   * the runtime hands the message to pi.
   */
  submit(ref: ConversationRef, input: EngineSubmission): Promise<"accepted" | "unavailable">;
  /** Stop the in-flight reply (and withdraw queued inputs). */
  abort(ref: ConversationRef): Promise<void>;
  /**
   * Withdraw a message by its request id. A queued one leaves the queue; a
   * placed one is already part of the running reply, and a settled one is done.
   */
  withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome>;
  /**
   * The chat state right now, for one-shot readers. The runtime derives
   * pages, the Bot list preview and Finished replies from it (`transcript.ts`,
   * `replies.ts`), the same way for both engines.
   */
  read(ref: ConversationRef): Promise<ChatState>;
  /** A `snapshot` first, then changes; with `window`, only the newest messages. */
  watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number },
  ): Promise<ChatSubscription>;
  /** The conversation's user messages, newest first, as the Tool gate reads them. */
  userMessages(ref: ConversationRef): Promise<readonly GateUserMessage[]>;
  /** A reply is running. */
  busy(ref: ConversationRef): boolean;
  close(): Promise<void>;
}

/**
 * What a Claude plan turn does when the engine is off or the worker is
 * unreachable: `gateway` hands it to the account's fallback model on pi,
 * `pause` ends it with an error.
 */
export type ClaudeEngineFallback = "gateway" | "pause";

/** The Claude plan account's switch and fallback, read on each turn. */
export interface ClaudePlanState {
  enabled: boolean;
  fallback: ClaudeEngineFallback;
  /** Claude Code `maxTurns` for a turn (`"unlimited"`: none); the worker's default when absent. */
  maxTurns?: MaxTurns;
}
