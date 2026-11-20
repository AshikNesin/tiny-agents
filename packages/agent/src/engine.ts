import type { MaxTurns } from "@tiny-agents/claude-worker";
import type { AgentChange } from "@earendil-works/pi-durable";
import type { AgentEngineKind } from "@tiny-agents/models";
import type { ClaudeSessionSync } from "./engines/claude-code/engine";
import type { GateUserMessage, Permissions } from "./policy";
import type {
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

export interface CompiledConversation {
  change: AgentChange;
  permissions?: Permissions;
  claude?: ClaudeSessionSync;
}

export interface EngineSubmission {
  requestId: string;
  text: string;
  images?: { data: string; mimeType: string }[];
  attachments?: AttachmentRef[];
  peer?: ChatMessage["peer"];
  author?: ChatMessage["author"];
  whenBusy?: "steer" | "followUp";
}

export interface AgentEngine {
  readonly kind: AgentEngineKind;
  start(): Promise<void>;
  configure(ref: ConversationRef, compiled: CompiledConversation): Promise<void>;
  runs(ref: ConversationRef): boolean;
  submit(ref: ConversationRef, input: EngineSubmission): Promise<"accepted" | "unavailable">;
  abort(ref: ConversationRef): Promise<void>;
  withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome>;
  read(ref: ConversationRef): Promise<ChatState>;
  watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number },
  ): Promise<ChatSubscription>;
  userMessages(ref: ConversationRef): Promise<readonly GateUserMessage[]>;
  busy(ref: ConversationRef): boolean;
  close(): Promise<void>;
}

export type ClaudeEngineFallback = "gateway" | "pause";

export interface ClaudePlanState {
  enabled: boolean;
  fallback: ClaudeEngineFallback;
  maxTurns?: MaxTurns;
}
