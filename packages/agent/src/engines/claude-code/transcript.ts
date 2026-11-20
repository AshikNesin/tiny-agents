import type { EntryRecord } from "@earendil-works/pi-durable";
import { z } from "zod";
import { toJson } from "../../durable-json";
import { NO_REPLY } from "../../transcript";
import type { ChatMessage, ChatToolCall, ChatToolStatus } from "../../types";

const CLAUDE_USER_ENTRY = "claude.user";
const CLAUDE_REPLY_ENTRY = "claude.assistant";
const CLAUDE_WITHDRAWN_ENTRY = "claude.withdrawn";

const APP_RESTARTED =
  "The app restarted and this reply was cut off. Send your message again to continue.";

const peerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reply"), name: z.string().min(1) }),
  z.object({ kind: z.literal("message"), name: z.string().min(1) }),
  z.object({ kind: z.literal("mention"), hostName: z.string().min(1) }),
]);

const authorSchema = z.object({ id: z.number(), name: z.string().min(1) });

const attachmentSchema = z.object({
  uploadId: z.string(),
  kind: z.enum(["image", "file"]),
  name: z.string(),
  mimeType: z.string(),
  size: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const userSchema = z.object({
  requestId: z.string().min(1),
  text: z.string(),
  createdAt: z.number(),
  peer: peerSchema.optional(),
  author: authorSchema.optional(),
  attachments: z.array(attachmentSchema).optional(),
});

const TOOL_STATUSES = [
  "pending",
  "running",
  "awaiting_approval",
  "awaiting_answer",
  "done",
  "error",
  "awaiting_credentials",
  "awaiting_takeover",
  "denied",
  "expired",
  "interrupted",
  "aborted",
] as const satisfies readonly ChatToolStatus[];

const toolCallSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  status: z.enum(TOOL_STATUSES),
});

const replySchema = z.object({
  turnId: z.string().min(1),
  text: z.string(),
  status: z.enum(["streaming", "done", "error", "stopped"]),
  error: z.string().optional(),
  model: z.string().optional(),
  toolCalls: z.array(toolCallSchema).optional(),
  createdAt: z.number(),
});

const withdrawnSchema = z.object({ requestIds: z.array(z.string()) });

export type ClaudeUser = z.infer<typeof userSchema>;
export type ClaudeReply = Omit<z.infer<typeof replySchema>, "toolCalls"> & {
  toolCalls?: ChatToolCall[];
};

export type ClaudeRecord =
  | { kind: "user"; data: ClaudeUser }
  | { kind: "reply"; data: ClaudeReply }
  | { kind: "withdrawn"; requestIds: string[] };

export function userEntry(data: ClaudeUser): { kind: string; data: ReturnType<typeof toJson> } {
  return { kind: CLAUDE_USER_ENTRY, data: toJson(data) };
}

export function replyEntry(data: ClaudeReply): { kind: string; data: ReturnType<typeof toJson> } {
  return { kind: CLAUDE_REPLY_ENTRY, data: toJson(data) };
}

export function withdrawnEntry(requestIds: string[]): {
  kind: string;
  data: ReturnType<typeof toJson>;
} {
  return { kind: CLAUDE_WITHDRAWN_ENTRY, data: toJson({ requestIds }) };
}

export function claudeRecordOf(
  entry: Pick<EntryRecord, "kind" | "data">,
): ClaudeRecord | undefined {
  if (entry.kind === CLAUDE_USER_ENTRY) {
    return { kind: "user", data: parseEntry(entry.kind, entry.data, userSchema) };
  }
  if (entry.kind === CLAUDE_REPLY_ENTRY) {
    const data = parseEntry(entry.kind, entry.data, replySchema);
    const { toolCalls, ...rest } = data;
    return {
      kind: "reply",
      data: { ...rest, ...(toolCalls ? { toolCalls: toolCalls.map(asToolCall) } : {}) },
    };
  }
  if (entry.kind === CLAUDE_WITHDRAWN_ENTRY) {
    return {
      kind: "withdrawn",
      requestIds: parseEntry(entry.kind, entry.data, withdrawnSchema).requestIds,
    };
  }
  return undefined;
}

export function admittedRequestId(entry: Pick<EntryRecord, "kind" | "data">): string | undefined {
  if (entry.kind !== CLAUDE_USER_ENTRY) return undefined;
  const parsed = userSchema.safeParse(entry.data);
  return parsed.success ? parsed.data.requestId : undefined;
}

function parseEntry<T>(kind: string, value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Stored "${kind}" entry does not fit its shape: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

function asToolCall(row: z.infer<typeof toolCallSchema>): ChatToolCall {
  return row as ChatToolCall;
}

const FINISHED_TOOL = new Set<ChatToolStatus>([
  "done",
  "error",
  "denied",
  "expired",
  "interrupted",
  "aborted",
]);

export function settleToolCalls(
  calls: readonly ChatToolCall[] | undefined,
  cut: "aborted" | "interrupted",
): ChatToolCall[] | undefined {
  if (!calls) return undefined;
  return calls.map((call) =>
    FINISHED_TOOL.has(call.status)
      ? call
      : { id: call.id, name: call.name, args: call.args, status: cut },
  );
}

export interface ClaudeLive {
  reply?: ClaudeReply;
  queued: ReadonlySet<string>;
}

export function claudeMessages(records: readonly ClaudeRecord[], live: ClaudeLive): ChatMessage[] {
  const withdrawn = new Set<string>();
  const replies = new Map<string, ClaudeReply>();
  const asked = new Set<string>();
  for (const record of records) {
    if (record.kind === "withdrawn") for (const id of record.requestIds) withdrawn.add(id);
    else if (record.kind === "reply") replies.set(record.data.turnId, record.data);
    else asked.add(record.data.requestId);
  }
  const running = live.reply;
  const out: ChatMessage[] = [];
  const shown = new Set<string>();
  for (const record of records) {
    if (record.kind === "withdrawn") continue;
    if (record.kind === "reply") {
      const { turnId } = record.data;
      if (asked.has(turnId) || shown.has(`a-${turnId}`)) continue;
      shown.add(`a-${turnId}`);
      out.push(replyMessage(replies.get(turnId) ?? record.data, false));
      continue;
    }
    const { requestId } = record.data;
    if (shown.has(`u-${requestId}`) || withdrawn.has(requestId)) continue;
    if (live.queued.has(requestId)) continue;
    shown.add(`u-${requestId}`);
    const isLive = running?.turnId === requestId;
    const reply = isLive ? running : replies.get(requestId);
    const user = userMessage(record.data);
    if (!reply) {
      out.push({ ...user, status: "unanswered", error: NO_REPLY });
      continue;
    }
    out.push(user);
    const message = replyMessage(reply, isLive);
    if (isLive && reply.status === "streaming" && !hasContent(message)) continue;
    out.push(message);
  }
  return out;
}

function hasContent(message: ChatMessage): boolean {
  return Boolean(message.text || message.toolCalls?.length || message.error);
}

function userMessage(data: ClaudeUser): ChatMessage {
  return {
    id: `u-${data.requestId}`,
    role: "user",
    text: data.text,
    requestId: data.requestId,
    status: "done",
    createdAt: data.createdAt,
    ...(data.peer ? { peer: data.peer } : {}),
    ...(data.author ? { author: data.author } : {}),
  };
}

function replyMessage(reply: ClaudeReply, live: boolean): ChatMessage {
  const cut = !live && reply.status === "streaming";
  const status = cut ? "error" : reply.status;
  const error = cut ? APP_RESTARTED : reply.error;
  const toolCalls = cut ? settleToolCalls(reply.toolCalls, "interrupted") : reply.toolCalls;
  return {
    id: `a-${reply.turnId}`,
    role: "assistant",
    text: reply.text,
    status,
    ...(error ? { error } : {}),
    ...(toolCalls?.length ? { toolCalls } : {}),
    ...(reply.model ? { model: reply.model } : {}),
    createdAt: reply.createdAt,
  };
}

const legacyMessageSchema = z.looseObject({
  id: z.string(),
  role: z.string(),
  text: z.string().optional(),
  status: z.string().optional(),
  requestId: z.string().optional(),
  createdAt: z.number().optional(),
  error: z.string().optional(),
  model: z.string().optional(),
  peer: z.unknown().optional(),
  author: z.unknown().optional(),
  toolCalls: z.array(z.unknown()).optional(),
});

export const legacyFileSchema = z.object({
  sessions: z
    .record(
      z.string(),
      z.looseObject({
        surface: z.string().optional(),
        claudeSessionId: z.string().optional(),
        messages: z.array(legacyMessageSchema).optional(),
      }),
    )
    .optional(),
});

export type LegacySession = NonNullable<z.infer<typeof legacyFileSchema>["sessions"]>[string];

export function legacyEntries(
  session: LegacySession,
): { kind: string; data: ReturnType<typeof toJson> }[] {
  const out: { kind: string; data: ReturnType<typeof toJson> }[] = [];
  const users = new Set<string>();
  const turns = new Set<string>();
  for (const message of session.messages ?? []) {
    if (message.role === "user") {
      const requestId =
        message.requestId || (message.id.startsWith("u-") ? message.id.slice(2) : message.id);
      if (!requestId || users.has(requestId)) continue;
      users.add(requestId);
      const peer = peerSchema.safeParse(message.peer);
      const author = authorSchema.safeParse(message.author);
      out.push(
        userEntry({
          requestId,
          text: message.text ?? "",
          createdAt: message.createdAt ?? 0,
          ...(peer.success ? { peer: peer.data } : {}),
          ...(author.success ? { author: author.data } : {}),
        }),
      );
      continue;
    }
    if (message.role !== "assistant") continue;
    const turnId = message.id.startsWith("a-") ? message.id.slice(2) : message.id;
    if (!turnId || turns.has(turnId)) continue;
    turns.add(turnId);
    const status = replySchema.shape.status.safeParse(message.status);
    const toolCalls = (message.toolCalls ?? []).flatMap((call) => {
      const parsed = toolCallSchema.safeParse(call);
      return parsed.success ? [asToolCall(parsed.data)] : [];
    });
    out.push(
      replyEntry({
        turnId,
        text: message.text ?? "",
        status: status.success ? status.data : "done",
        ...(message.error ? { error: message.error } : {}),
        ...(message.model ? { model: message.model } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
        createdAt: message.createdAt ?? 0,
      }),
    );
  }
  return out;
}
