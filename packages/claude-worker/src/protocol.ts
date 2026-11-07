/**
 * Wire protocol between tiny-agents and the Claude Code worker (bot chats).
 * One WebSocket, per-session sequence numbers, tool results keyed by tool_use_id.
 * Welcome, ping/pong and replies are the socket's envelope (`envelope.ts`).
 * Neither side puts a Claude credential on this socket.
 */
import { z } from "zod";
import type { Sequenced } from "./session-log";

export const DEFAULT_TIMINGS = {
  /** Ping interval. An idle socket stays up for hours because each ping resets silence. */
  pingIntervalMs: 20_000,
  /** Close when nothing (including pongs) arrives for this long. */
  silenceCloseMs: 60_000,
  reconnectMinMs: 1_000,
  reconnectMaxMs: 30_000,
  /** Events retained per session so a reconnecting client can resume. */
  eventBuffer: 1_000,
  toolResultTimeoutMs: 120_000,
  /** Evict an idle Claude process after this long. */
  idleEvictMs: 15 * 60_000,
  /** Recycle a session process older than this; the Claude session id is kept for resume. */
  maxSessionAgeMs: 6 * 60 * 60_000,
  maxLiveProcesses: 2,
  maxRunningTurns: 1,
  /** Claude Code `maxTurns` for one query(). Tools are proxied, so a turn can take several. */
  maxTurns: 30,
} as const;

export type Timings = {
  [K in keyof typeof DEFAULT_TIMINGS]: number;
};

export function timingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  defaults: Timings = DEFAULT_TIMINGS,
): Timings {
  const num = (key: string, fallback: number): number => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    pingIntervalMs: num("CLAUDE_WORKER_PING_MS", defaults.pingIntervalMs),
    silenceCloseMs: num("CLAUDE_WORKER_SILENCE_MS", defaults.silenceCloseMs),
    reconnectMinMs: num("CLAUDE_WORKER_RECONNECT_MIN_MS", defaults.reconnectMinMs),
    reconnectMaxMs: num("CLAUDE_WORKER_RECONNECT_MAX_MS", defaults.reconnectMaxMs),
    eventBuffer: num("CLAUDE_WORKER_EVENT_BUFFER", defaults.eventBuffer),
    toolResultTimeoutMs: num("CLAUDE_WORKER_TOOL_TIMEOUT_MS", defaults.toolResultTimeoutMs),
    idleEvictMs: num("CLAUDE_WORKER_IDLE_MS", defaults.idleEvictMs),
    maxSessionAgeMs: num("CLAUDE_WORKER_MAX_AGE_MS", defaults.maxSessionAgeMs),
    maxLiveProcesses: num("CLAUDE_WORKER_MAX_PROCESSES", defaults.maxLiveProcesses),
    maxRunningTurns: num("CLAUDE_WORKER_MAX_TURNS", defaults.maxRunningTurns),
    maxTurns: num("CLAUDE_WORKER_QUERY_MAX_TURNS", defaults.maxTurns),
  };
}

export function reconnectDelayMs(
  attempt: number,
  timings: Pick<Timings, "reconnectMinMs" | "reconnectMaxMs">,
): number {
  const exp = timings.reconnectMinMs * 2 ** Math.max(0, attempt);
  return Math.min(timings.reconnectMaxMs, exp);
}

/** JSON Schema documents are open: extra keywords (items, additionalProperties) stay. */
const jsonSchema: z.ZodType<JsonSchema> = z.lazy(() =>
  z.looseObject({
    type: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }),
);

export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export const toolSpecSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: jsonSchema,
});

export type ToolSpec = z.infer<typeof toolSpecSchema>;

const imagePartSchema = z.strictObject({
  data: z.string(),
  mimeType: z.string().min(1),
});

export type ImagePart = z.infer<typeof imagePartSchema>;

export const sessionEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("session"), claudeSessionId: z.string().min(1) }),
  z.strictObject({ type: z.literal("text"), turnId: z.string(), text: z.string() }),
  z.strictObject({
    type: z.literal("tool_use"),
    turnId: z.string(),
    toolUseId: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
  }),
  z.strictObject({
    type: z.literal("turn_end"),
    turnId: z.string(),
    stopReason: z.enum(["end_turn", "error", "paused", "aborted"]),
    error: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("usage_pause"),
    turnId: z.string(),
    reason: z.string(),
  }),
]);

export type SessionEvent = z.infer<typeof sessionEventSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ping") }),
  z.strictObject({ type: z.literal("pong") }),
  z.strictObject({
    type: z.literal("resume"),
    /** Answered with a `ResumeResult` reply before the replay. */
    requestId: z.string().min(1).max(100).optional(),
    sessionId: z.string().min(1),
    afterSeq: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("abort"), sessionId: z.string().min(1) }),
  z.strictObject({
    type: z.literal("tool_result"),
    sessionId: z.string().min(1),
    toolUseId: z.string().min(1),
    content: z.string(),
    isError: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("turn"),
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    text: z.string(),
    model: z.string().min(1),
    system: z.string().optional(),
    resume: z.string().optional(),
    tools: z.array(toolSpecSchema).optional(),
    images: z.array(imagePartSchema).optional(),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const workerMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    sessionId: z.string().optional(),
    turnId: z.string().optional(),
  }),
  z.strictObject({
    type: z.literal("event"),
    sessionId: z.string().min(1),
    seq: z.number().int().positive(),
    event: sessionEventSchema,
  }),
]);

export type WorkerMessage = z.infer<typeof workerMessageSchema>;

export type ToolResultPayload = { content: string; isError?: boolean };

export function parseClientMessage(value: unknown): ClientMessage | undefined {
  const parsed = clientMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseWorkerMessage(value: unknown): WorkerMessage | undefined {
  const parsed = workerMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Buffered event as the worker stores and replays it. */
export type SequencedEvent = Sequenced<SessionEvent>;
