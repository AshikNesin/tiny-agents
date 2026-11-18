/**
 * Traces (issue #363): a conversation's model and tool calls as metadata,
 * read from the entries it already stores. Nothing here is written: a pi
 * `pi.assistant` entry is one model call (model, usage, cost, stop reason,
 * duration), a `pi.tool-result` entry one tool call, and `pi.usage` holds
 * the conversation's totals. Text is clipped to a preview; the full content
 * stays in the transcript.
 *
 * Field meanings follow the OpenTelemetry GenAI conventions (provider,
 * request model, finish reason, input/output/cache tokens), so an exporter
 * could map them one to one.
 */
import type { EntryRecord, UsageState } from "@earendil-works/pi-durable";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { claudeRecordOf, type ClaudeReply } from "./engines/claude-code/transcript";
import { userMessagesOf } from "./transcript";

/** Characters of a turn's input kept as its preview. */
const INPUT_PREVIEW = 200;
/** Characters of a failed call's error kept. */
const ERROR_PREVIEW = 300;

export interface TraceUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Reasoning tokens (a part of `output`), when the provider reports them. */
  reasoning?: number;
  costUsd: number;
}

/** A conversation's totals, and the models that ran in it. */
export interface ConversationUsage extends TraceUsage {
  /** Model ids, most tokens first (from `pi.usage` keys `provider/model`). */
  models: string[];
}

/** Which engine made the call: pi (any provider) or the Claude plan (Claude Code). */
export type TraceHarness = "pi" | "claude-plan";

export type TraceStep =
  | {
      type: "llm";
      /** When the request started (ms). */
      at: number;
      durationMs?: number;
      harness: TraceHarness;
      provider?: string;
      model: string;
      /** The model the provider answered with, when it differs. */
      responseModel?: string;
      thinkingLevel?: string;
      /** pi-ai stop reason (stop, toolUse, length, error, aborted) or the Claude plan's turn status. */
      stopReason: string;
      error?: string;
      /** Absent where the harness does not report usage (the Claude plan). */
      usage?: TraceUsage;
      /** Names of the tools this call asked for, in order. */
      toolCalls: string[];
    }
  | {
      type: "tool";
      at: number;
      durationMs?: number;
      name: string;
      error: boolean;
      /** The tool's own model spend (vision), when it reports one. */
      usage?: TraceUsage;
    }
  | { type: "compaction"; reason: string };

export interface TraceTurn {
  /** When the turn's input arrived (ms); the first call's start when it has none. */
  at: number;
  /** The input's first characters; empty for calls before any input. */
  input: string;
  /** Another bot's message, a relayed reply or a mention, not the owner's. */
  peer: boolean;
  steps: TraceStep[];
}

export interface ConversationTrace {
  turns: TraceTurn[];
  /** The conversation's `pi.usage` totals: every model call, compaction and tool spend. */
  usage: ConversationUsage;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** One pi-ai `Usage` as trace usage. */
function traceUsageOf(usage: Partial<Usage> | undefined): TraceUsage | undefined {
  if (!usage) return undefined;
  return {
    input: finite(usage.input),
    output: finite(usage.output),
    cacheRead: finite(usage.cacheRead),
    cacheWrite: finite(usage.cacheWrite),
    ...(usage.reasoning !== undefined ? { reasoning: finite(usage.reasoning) } : {}),
    costUsd: finite(usage.cost?.total),
  };
}

/** The sum of a conversation's `pi.usage` buckets (models and tools). */
export function usageTotalsOf(state: Readonly<UsageState> | undefined): ConversationUsage {
  const total: ConversationUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: 0,
    models: [],
  };
  if (!state) return total;
  total.models = Object.entries(state.models ?? {})
    .map(([key, usage]) => ({
      model: key.slice(key.indexOf("/") + 1),
      tokens: finite((usage as Partial<Usage>).totalTokens),
    }))
    .sort((a, b) => b.tokens - a.tokens)
    .map((row) => row.model)
    .filter((model, i, all) => all.indexOf(model) === i);
  for (const bucket of [state.models, state.tools]) {
    for (const entry of Object.values(bucket ?? {})) {
      const usage = traceUsageOf(entry as Partial<Usage>);
      if (!usage) continue;
      total.input += usage.input;
      total.output += usage.output;
      total.cacheRead += usage.cacheRead;
      total.cacheWrite += usage.cacheWrite;
      if (usage.reasoning !== undefined) total.reasoning = (total.reasoning ?? 0) + usage.reasoning;
      total.costUsd += usage.costUsd;
    }
  }
  return total;
}

function llmStep(message: AssistantMessage): TraceStep {
  const usage = traceUsageOf(message.usage);
  return {
    type: "llm",
    at: finite(message.timestamp),
    ...(message.durationMs !== undefined ? { durationMs: message.durationMs } : {}),
    harness: "pi",
    provider: message.provider,
    model: message.model,
    ...(message.responseModel && message.responseModel !== message.model
      ? { responseModel: message.responseModel }
      : {}),
    ...(message.thinkingLevel ? { thinkingLevel: message.thinkingLevel } : {}),
    stopReason: message.stopReason,
    ...(message.errorMessage ? { error: clip(message.errorMessage, ERROR_PREVIEW) } : {}),
    ...(usage ? { usage } : {}),
    toolCalls: (message.content ?? []).flatMap((block) =>
      block.type === "toolCall" ? [block.name] : [],
    ),
  };
}

function toolStep(message: ToolResultMessage): TraceStep {
  const usage = traceUsageOf(message.usage);
  return {
    type: "tool",
    at: finite(message.timestamp),
    ...(message.durationMs !== undefined ? { durationMs: message.durationMs } : {}),
    name: message.toolName,
    error: message.isError,
    ...(usage && (usage.input > 0 || usage.output > 0) ? { usage } : {}),
  };
}

function claudeStep(reply: ClaudeReply): TraceStep {
  return {
    type: "llm",
    at: reply.createdAt,
    harness: "claude-plan",
    model: reply.model ?? "Claude plan",
    stopReason: reply.status,
    ...(reply.error ? { error: clip(reply.error, ERROR_PREVIEW) } : {}),
    toolCalls: (reply.toolCalls ?? []).map((call) => call.name),
  };
}

/**
 * A conversation's turns and their calls, from its stored entries (ascending)
 * and its `pi.usage` document. A Claude plan turn is one step: its reply
 * entries are snapshots of the same turn, and the newest wins. `usage` is the
 * conversation's totals (`usageTotalsOf` its `pi.usage`).
 */
export function traceOf(
  entries: readonly EntryRecord[],
  usage: ConversationUsage,
): ConversationTrace {
  const turns: TraceTurn[] = [];
  let current: TraceTurn | undefined;
  const claudeTurns = new Map<string, { turn: TraceTurn; index: number }>();

  const push = (step: TraceStep, at: number) => {
    if (!current) {
      current = { at, input: "", peer: false, steps: [] };
      turns.push(current);
    }
    current.steps.push(step);
  };

  for (const entry of entries) {
    if (entry.kind === "pi.user" || entry.kind === "chat.user") {
      const user = userMessagesOf([entry])[0];
      const message = entry.model?.[0] as { timestamp?: number } | undefined;
      current = {
        at: finite(message?.timestamp),
        input: clip(user?.text ?? "", INPUT_PREVIEW),
        peer: user?.peer ?? false,
        steps: [],
      };
      turns.push(current);
      continue;
    }
    if (entry.kind === "pi.assistant") {
      const message = entry.model?.[0];
      if (message?.role === "assistant") push(llmStep(message), finite(message.timestamp));
      continue;
    }
    if (entry.kind === "pi.tool-result") {
      const message = entry.model?.[0];
      if (message?.role === "toolResult") push(toolStep(message), finite(message.timestamp));
      continue;
    }
    if (entry.kind === "pi.compaction") {
      const data = entry.data as { reason?: unknown } | undefined;
      push({ type: "compaction", reason: String(data?.reason ?? "context") }, current?.at ?? 0);
      continue;
    }
    let record: ReturnType<typeof claudeRecordOf>;
    try {
      record = claudeRecordOf(entry);
    } catch {
      continue;
    }
    if (record?.kind === "user") {
      current = {
        at: record.data.createdAt,
        input: clip(record.data.text, INPUT_PREVIEW),
        peer: record.data.peer !== undefined,
        steps: [],
      };
      turns.push(current);
    } else if (record?.kind === "reply") {
      const step = claudeStep(record.data);
      const seen = claudeTurns.get(record.data.turnId);
      if (seen) {
        seen.turn.steps[seen.index] = step;
      } else {
        push(step, record.data.createdAt);
        claudeTurns.set(record.data.turnId, { turn: current!, index: current!.steps.length - 1 });
      }
    }
  }
  return { turns, usage };
}
