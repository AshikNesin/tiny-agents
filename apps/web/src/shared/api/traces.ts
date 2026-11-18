/**
 * The Traces page's wire types (`server/api/traces/*`, issue #363). Times
 * are epoch milliseconds. A session is one durable conversation; its trace
 * is read from the conversation's stored entries, never copied.
 */
import type { ConversationTrace, ConversationUsage } from "@tiny-agents/agent";

export type { TraceStep, TraceTurn } from "@tiny-agents/agent";

/** chat: a bot's current chat; past_chat: a retired one; routine: one run; delivery: one bot-to-bot message. */
export type TraceSessionKind = "chat" | "past_chat" | "routine" | "delivery";

/** The list's filter: `chats` is a bot's chat and its Past chats. */
export type TraceSessionFilter = "chats" | "routine" | "delivery";

export interface TraceSession {
  /** The durable conversation id. */
  id: string;
  kind: TraceSessionKind;
  title: string;
  bot: { id: string; name: string };
  /** A Past chat's id, for its link. */
  chatId?: string;
  startedAt: number;
  lastAt: number;
  /** The engine the bot runs on now. */
  harness: "pi" | "claude-plan";
  /** Null when the conversation could not be read (deleted from the store). */
  usage: ConversationUsage | null;
}

/** `GET /traces/sessions`. `next` is the `before` of the following page. */
export interface TraceSessionList {
  sessions: TraceSession[];
  next: number | null;
}

/** `GET /traces/sessions/:id`. */
export interface TraceSessionDetail {
  session: TraceSession;
  trace: ConversationTrace;
}

/** One side-call: a model call made outside any conversation. */
export interface SideCall {
  id: string;
  purpose: string;
  bot: { id: string; name: string } | null;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  durationMs: number | null;
  outcome: "ok" | "error" | "timeout" | "aborted";
  error: string | null;
  createdAt: number;
}

/** `GET /traces/side-calls`. */
export interface SideCallList {
  calls: SideCall[];
  next: number | null;
}

/** `GET /traces/summary`: the last 7 days, sessions active in it and side-calls made in it. */
export interface TraceSummary {
  since: number;
  sessions: number;
  costUsd: number;
  tokens: number;
  sideCalls: number;
}
