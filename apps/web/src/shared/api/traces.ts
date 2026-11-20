import type { ConversationTrace, ConversationUsage } from "@tiny-agents/agent";

export type { TraceEvent, TraceTurn } from "@tiny-agents/agent";

export type TraceSessionKind = "chat" | "past_chat" | "routine" | "delivery";

export type TraceSessionFilter = "chats" | "routine" | "delivery";

export interface TraceSession {
  id: string;
  kind: TraceSessionKind;
  title: string;
  bot: { id: string; name: string };
  chatId?: string;
  startedAt: number;
  lastAt: number;
  harness: "pi" | "claude-plan";
  usage: ConversationUsage | null;
}

export interface TraceSessionList {
  sessions: TraceSession[];
  next: number | null;
}

export interface TraceSessionDetail {
  session: TraceSession;
  trace: ConversationTrace;
}

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

export interface SideCallList {
  calls: SideCall[];
  next: number | null;
}

export interface TraceSummary {
  since: number;
  sessions: number;
  costUsd: number;
  tokens: number;
  sideCalls: number;
}
