import { defineDoc, type ToolRegistration } from "@earendil-works/pi-durable";
import type { ClientMessage, ToolSpec } from "@tiny-agents/claude-worker";
import type { ToolPermission } from "../../capabilities";
import type { ClaudePlanState, EngineSubmission } from "../../engine";
import { windowChat } from "../../transcript";
import type {
  ChatEvent,
  ChatMessage,
  ChatState,
  ConversationRef,
  QueuedMessage,
} from "../../types";
import type { ClaudeRecord, ClaudeReply, ClaudeUser } from "./transcript";

const TASK_ID_BASE = 2_000_000_000;

export const ClaudePlanDoc = defineDoc<{
  conversations: Record<string, { left?: boolean; claudeSessionId?: string }>;
  imported?: boolean;
}>({
  kind: "tiny.claude-plan",
  version: 1,
  scope: "session",
  initial: () => ({ conversations: {} }),
  checkpointWhen: () => false,
});

export interface Listener {
  ref: ConversationRef;
  listener: (events: ChatEvent[]) => void | Promise<void>;
  window?: number;
}

export interface LiveTurn {
  turnId: string;
  reply: ClaudeReply;
  sent: boolean;
  dispatched: boolean;
  closed: boolean;
  waits: Map<string, ReturnType<typeof setInterval>>;
}

export interface Stored {
  left: boolean;
  claudeSessionId?: string;
}

export interface ClaudeSession {
  model: string;
  system: string;
  tools: ToolSpec[];
  permissions: Record<string, ToolPermission>;
  runners: ReadonlyMap<string, ToolRegistration>;
  configured: boolean;
  claudeSessionId?: string;
  surface: "claude" | "pi";
  stored?: Stored;
  records?: Promise<ClaudeRecord[]>;
  queue: EngineSubmission[];
  withdrawing: Set<string>;
  live?: LiveTurn;
  nextTask: number;
  busy: boolean;
  writes: Promise<unknown>;
}

export function blankSession(): ClaudeSession {
  return {
    model: "",
    system: "",
    tools: [],
    permissions: {},
    runners: new Map(),
    configured: false,
    surface: "claude",
    queue: [],
    withdrawing: new Set(),
    nextTask: TASK_ID_BASE,
    busy: false,
    writes: Promise.resolve(),
  };
}

export function sessionState(
  session: ClaudeSession,
  messages: ChatMessage[],
  window?: number,
): ChatState {
  const state = { messages, busy: session.busy, queued: queuedOf(session) };
  return window && messages.length > window ? windowChat(state, window)! : state;
}

function queuedOf(session: ClaudeSession): QueuedMessage[] {
  return session.queue
    .filter((input) => !input.peer)
    .map((input) => ({
      requestId: input.requestId,
      mode: "followUp" as const,
      text: input.text,
      ...(input.author ? { author: input.author } : {}),
    }));
}

export function newLiveTurn(turnId: string, model: string): LiveTurn {
  return {
    turnId,
    reply: {
      turnId,
      text: "",
      status: "streaming",
      ...(model ? { model } : {}),
      createdAt: Date.now(),
    },
    sent: false,
    dispatched: false,
    closed: false,
    waits: new Map(),
  };
}

export function submittedUser(input: EngineSubmission): ClaudeUser {
  return {
    requestId: input.requestId,
    text: input.text,
    createdAt: Date.now(),
    ...(input.peer ? { peer: input.peer } : {}),
    ...(input.author ? { author: { id: input.author.id, name: input.author.name } } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };
}

export function pausedReply(turnId: string, error: string): ClaudeReply {
  return {
    turnId,
    text: "",
    status: "error",
    error,
    createdAt: Date.now(),
  };
}

export function turnRequest(
  ref: ConversationRef,
  session: ClaudeSession,
  input: EngineSubmission,
  maxTurns: ClaudePlanState["maxTurns"],
): Extract<ClientMessage, { type: "turn" }> {
  return {
    type: "turn",
    sessionId: String(ref),
    turnId: input.requestId,
    text: input.text,
    model: session.model,
    system: session.system,
    ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
    tools: session.tools,
    ...(input.images?.length ? { images: input.images } : {}),
    ...(maxTurns ? { maxTurns } : {}),
  };
}
