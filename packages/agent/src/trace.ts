import type { EntryRecord, UsageState } from "@earendil-works/pi-durable";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { claudeRecordOf, type ClaudeReply } from "./engines/claude-code/transcript";
import { userMessagesOf } from "./transcript";

const INPUT_PREVIEW = 200;
const ERROR_PREVIEW = 300;
const TEXT_LIMIT = 20_000;
const OUTPUT_LIMIT = 8_000;
const ARG_LIMIT = 4_000;

export interface TraceUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  costUsd: number;
}

export interface ConversationUsage extends TraceUsage {
  models: string[];
}

export type TraceHarness = "pi" | "claude-plan";

export type TraceStep =
  | {
      type: "llm";
      at: number;
      durationMs?: number;
      harness: TraceHarness;
      provider?: string;
      model: string;
      responseModel?: string;
      thinkingLevel?: string;
      stopReason: string;
      error?: string;
      usage?: TraceUsage;
      toolCalls: string[];
    }
  | {
      type: "tool";
      at: number;
      durationMs?: number;
      name: string;
      error: boolean;
      usage?: TraceUsage;
    }
  | { type: "compaction"; reason: string };

export type TraceEvent =
  | { type: "prompt"; at: number; text: string; peer: boolean }
  | { type: "response"; at: number; text: string }
  | { type: "thinking"; at: number; text: string; redacted?: boolean }
  | {
      type: "tool";
      at: number;
      name: string;
      input: Record<string, unknown>;
      output?: string;
      error: boolean;
      durationMs?: number;
    }
  | { type: "compaction"; at: number; reason: string; summary: string };

export interface TraceTurn {
  at: number;
  input: string;
  peer: boolean;
  steps: TraceStep[];
  events: TraceEvent[];
}

export interface ConversationTrace {
  turns: TraceTurn[];
  usage: ConversationUsage;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function cut(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}\n… (${text.length - max} more characters)`
    : text;
}

function argsOf(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([key, value]) => {
      if (typeof value === "string") return [key, cut(value, ARG_LIMIT)];
      if (value && typeof value === "object") {
        const json = JSON.stringify(value);
        return [key, json.length > ARG_LIMIT ? cut(json, ARG_LIMIT) : value];
      }
      return [key, value];
    }),
  );
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string }) =>
      block?.type === "text" ? (block.text ?? "") : block?.type === "image" ? "[image]" : "",
    )
    .filter(Boolean)
    .join("\n");
}

function assistantEvents(message: AssistantMessage): TraceEvent[] {
  const at = finite(message.timestamp);
  const events: TraceEvent[] = [];
  for (const block of message.content ?? []) {
    if (block.type === "thinking") {
      if (block.redacted) events.push({ type: "thinking", at, text: "", redacted: true });
      else if (block.thinking.trim()) {
        events.push({ type: "thinking", at, text: cut(block.thinking, TEXT_LIMIT) });
      }
    } else if (block.type === "text") {
      if (block.text.trim())
        events.push({ type: "response", at, text: cut(block.text, TEXT_LIMIT) });
    } else if (block.type === "toolCall") {
      events.push({
        type: "tool",
        at,
        name: block.name,
        input: argsOf(block.arguments),
        error: false,
      });
    }
  }
  return events;
}

function claudeEvents(reply: ClaudeReply): TraceEvent[] {
  const at = reply.createdAt;
  const events: TraceEvent[] = (reply.toolCalls ?? []).map((call) => ({
    type: "tool" as const,
    at,
    name: call.name,
    input: argsOf(call.args),
    ...(call.output !== undefined ? { output: cut(call.output, OUTPUT_LIMIT) } : {}),
    error: call.status === "error" || call.status === "denied",
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
  }));
  if (reply.text.trim()) events.push({ type: "response", at, text: cut(reply.text, TEXT_LIMIT) });
  return events;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

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

export function traceOf(
  entries: readonly EntryRecord[],
  usage: ConversationUsage,
): ConversationTrace {
  const turns: TraceTurn[] = [];
  let current: TraceTurn | undefined;
  const claudeTurns = new Map<string, { turn: TraceTurn; index: number; events: TraceEvent[] }>();
  let pending: { id: string; event: Extract<TraceEvent, { type: "tool" }> }[] = [];

  const open = (at: number): TraceTurn => {
    if (!current) {
      current = { at, input: "", peer: false, steps: [], events: [] };
      turns.push(current);
    }
    return current;
  };
  const startTurn = (at: number, text: string, peer: boolean) => {
    current = {
      at,
      input: clip(text, INPUT_PREVIEW),
      peer,
      steps: [],
      events: [{ type: "prompt", at, text: cut(text, TEXT_LIMIT), peer }],
    };
    turns.push(current);
  };

  for (const entry of entries) {
    if (entry.kind === "pi.user" || entry.kind === "chat.user") {
      const user = userMessagesOf([entry])[0];
      const message = entry.model?.[0] as { timestamp?: number } | undefined;
      startTurn(finite(message?.timestamp), user?.text ?? "", user?.peer ?? false);
      continue;
    }
    if (entry.kind === "pi.assistant") {
      const message = entry.model?.[0];
      if (message?.role !== "assistant") continue;
      const turn = open(finite(message.timestamp));
      turn.steps.push(llmStep(message));
      const events = assistantEvents(message);
      turn.events.push(...events);
      const calls = (message.content ?? []).flatMap((block) =>
        block.type === "toolCall" ? [block.id] : [],
      );
      const tools = events.filter((event) => event.type === "tool");
      pending = tools.map((event, i) => ({ id: calls[i] ?? "", event }));
      if (message.errorMessage) {
        turn.events.push({
          type: "response",
          at: finite(message.timestamp),
          text: `Error: ${clip(message.errorMessage, ERROR_PREVIEW)}`,
        });
      }
      continue;
    }
    if (entry.kind === "pi.tool-result") {
      const message = entry.model?.[0];
      if (message?.role !== "toolResult") continue;
      const turn = open(finite(message.timestamp));
      turn.steps.push(toolStep(message));
      const i = pending.findIndex(
        (call) =>
          (message.toolCallId && call.id === message.toolCallId) ||
          (!message.toolCallId && call.event.name === message.toolName),
      );
      const output = cut(contentText(message.content), OUTPUT_LIMIT);
      if (i >= 0) {
        const [{ event }] = pending.splice(i, 1);
        event.output = output;
        event.error = message.isError;
        if (message.durationMs !== undefined) event.durationMs = message.durationMs;
      } else {
        turn.events.push({
          type: "tool",
          at: finite(message.timestamp),
          name: message.toolName,
          input: {},
          output,
          error: message.isError,
          ...(message.durationMs !== undefined ? { durationMs: message.durationMs } : {}),
        });
      }
      continue;
    }
    if (entry.kind === "pi.compaction") {
      const data = entry.data as { reason?: unknown } | undefined;
      const reason = String(data?.reason ?? "context");
      const turn = open(current?.at ?? 0);
      turn.steps.push({ type: "compaction", reason });
      turn.events.push({
        type: "compaction",
        at: turn.at,
        reason,
        summary: cut(contentText((entry.model?.[0] as { content?: unknown })?.content), TEXT_LIMIT),
      });
      continue;
    }
    let record: ReturnType<typeof claudeRecordOf>;
    try {
      record = claudeRecordOf(entry);
    } catch {
      continue;
    }
    if (record?.kind === "user") {
      startTurn(record.data.createdAt, record.data.text, record.data.peer !== undefined);
    } else if (record?.kind === "reply") {
      const step = claudeStep(record.data);
      const events = claudeEvents(record.data);
      const seen = claudeTurns.get(record.data.turnId);
      if (seen) {
        seen.turn.steps[seen.index] = step;
        const at = seen.turn.events.indexOf(seen.events[0]!);
        if (at >= 0) seen.turn.events.splice(at, seen.events.length, ...events);
        else seen.turn.events.push(...events);
        seen.events = events;
      } else {
        const turn = open(record.data.createdAt);
        turn.steps.push(step);
        turn.events.push(...events);
        claudeTurns.set(record.data.turnId, { turn, index: turn.steps.length - 1, events });
      }
    }
  }
  return { turns, usage };
}
