/**
 * Inference engine seam (ADR 0014). `pi` is the pi-durable harness
 * (default). `claude-code` sends turns to the Claude Code worker, which
 * drives the official Agent SDK. The model id `claude-code/<model>` selects
 * it. Both are `AgentEngine`s: the runtime picks one per conversation and
 * calls it; neither knows about the other. Tool calls of both go through
 * the one Tool gate (`gate.ts`).
 */
import type { AgentChange } from "@earendil-works/pi-durable";
import type { ClaudeSessionSync } from "./engines/claude-code/engine";
import type { GateUserMessage, Permissions } from "./policy";
import type {
  AgentEngineKind,
  AttachmentRef,
  BotAgentConfig,
  ChatEvent,
  ChatMessage,
  ChatPage,
  ChatState,
  ChatSubscription,
  ConversationRef,
  LastMessage,
} from "./types";

export type { AgentEngineKind };

export const CLAUDE_CODE_MODEL_PREFIX = "claude-code/";

/** Picker note shown beside every Claude plan model. */
export const CLAUDE_PLAN_NOTE = "uses your Claude plan";

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
  /** Placement while a reply runs: "steer" joins it, "followUp" (default) waits. */
  whenBusy?: "steer" | "followUp";
}

/**
 * One way of running a bot conversation's turns and keeping its transcript.
 * Per conversation: the runtime asks `runs(ref)` to pick the engine, then
 * calls only that one. Busy changes are reported through the callback the
 * engine was built with; the runtime merges them into the bot activity.
 */
export interface AgentEngine {
  readonly kind: AgentEngineKind;
  /**
   * Take the conversation's compiled config, after every create and
   * configure. An engine keeps what it runs with, and lets go of a
   * conversation the config no longer gives it.
   */
  configure(ref: ConversationRef, compiled: CompiledConversation): Promise<void>;
  /** Whether this engine runs the conversation's turns now. */
  runs(ref: ConversationRef): boolean;
  /**
   * Admit a user message. `unavailable`: the engine cannot run the turn and
   * its fallback is another engine (the runtime decides which, and latches).
   */
  submit(ref: ConversationRef, input: EngineSubmission): Promise<"accepted" | "unavailable">;
  /** Stop the in-flight reply (and withdraw queued inputs). */
  abort(ref: ConversationRef): Promise<void>;
  /** The chat state right now, for one-shot readers. */
  read(ref: ConversationRef): Promise<ChatState>;
  /** Up to `limit` messages just before message `before`, oldest first. */
  page(
    ref: ConversationRef,
    query: { before: string; limit: number },
  ): Promise<ChatPage | undefined>;
  /** A `snapshot` first, then changes; with `window`, only the newest messages. */
  watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number },
  ): Promise<ChatSubscription>;
  /** The newest user or assistant message with something to show (the Bot list preview). */
  lastMessage(ref: ConversationRef): Promise<LastMessage | undefined>;
  /** The conversation's user messages, newest first, as the Tool gate reads them. */
  userMessages(ref: ConversationRef): Promise<readonly GateUserMessage[]>;
  /** A reply is running. */
  busy(ref: ConversationRef): boolean;
  close(): Promise<void>;
}

/** The engine a model id selects. Anything other than `claude-code/…` is pi. */
export function engineKindForModel(modelId: string): AgentEngineKind {
  return claudeCodeBareModel(modelId) ? "claude-code" : "pi";
}

/**
 * The engine a bot config selects. An explicit `engine` must agree with the
 * model id so a saved bot cannot claim one engine and run the other.
 */
export function engineKindForConfig(
  config: Pick<BotAgentConfig, "modelId" | "engine">,
): AgentEngineKind {
  const fromId = engineKindForModel(config.modelId);
  if (config.engine && config.engine !== fromId) {
    throw new Error(`Bot engine "${config.engine}" does not match model "${config.modelId}".`);
  }
  return fromId;
}

/**
 * Model id Claude Code should run (`claude-sonnet-4-6`), or undefined when
 * the id is not a Claude plan selection. Rejects empty, whitespace, and
 * extra slashes so the id cannot smuggle a path or a second provider.
 */
export function claudeCodeBareModel(modelId: string): string | undefined {
  if (!modelId.startsWith(CLAUDE_CODE_MODEL_PREFIX)) return undefined;
  const bare = modelId.slice(CLAUDE_CODE_MODEL_PREFIX.length);
  if (!bare || /\s/.test(bare) || bare.includes("/")) return undefined;
  return bare;
}

/** Kill switch. Read on each turn so flipping it does not require a worker redeploy. */
export function claudeCodeEngineEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = env.CLAUDE_CODE_ENGINE_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export type ClaudeEngineFallback = "gateway" | "pause";

/** What a turn does when the engine is off or the worker is unreachable. Default: pause. */
export function claudeCodeFallback(
  env: Readonly<Record<string, string | undefined>>,
): ClaudeEngineFallback {
  return env.CLAUDE_CODE_ENGINE_FALLBACK?.trim().toLowerCase() === "gateway" ? "gateway" : "pause";
}
