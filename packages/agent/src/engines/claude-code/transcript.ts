/**
 * The Claude plan's transcript as durable entries (ADR 0018). A Claude plan
 * conversation keeps its messages in the same pi-durable conversation pi
 * uses, as entries of its own kinds that carry no model context, so pi never
 * reads them and pi's chat never shows them:
 *
 * - `claude.user`: one admitted message, keyed by its request id.
 * - `claude.assistant`: a turn's reply, keyed by its turn id (the request id
 *   of the message it answers). Written when a tool call of the turn
 *   finishes and when the turn ends; the newest one per turn wins.
 * - `claude.withdrawn`: queued messages withdrawn before their turn ran.
 *
 * This module owns their shapes, reads them back (every read parses), and
 * projects them into the chat the owner sees, plus the one-time import of
 * the JSON file the engine kept before.
 */
import type { EntryRecord } from "@earendil-works/pi-durable";
import { z } from "zod";
import { toJson } from "../../durable-json";
import { NO_REPLY } from "../../transcript";
import type { ChatMessage, ChatToolCall, ChatToolStatus } from "../../types";

const CLAUDE_USER_ENTRY = "claude.user";
const CLAUDE_REPLY_ENTRY = "claude.assistant";
const CLAUDE_WITHDRAWN_ENTRY = "claude.withdrawn";

/** How a reply cut off by an app restart reads: the turn did not survive it (ADR 0014). */
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
  /** Kept for the record; the chat does not show them on the Claude plan (as before). */
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

/** A tool-call row as the chat had it; its card fields stay as they were written. */
const toolCallSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  status: z.enum(TOOL_STATUSES),
});

const replySchema = z.object({
  turnId: z.string().min(1),
  text: z.string(),
  /** `streaming`: written mid-turn (a tool call finished); the turn has not ended. */
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

/** One `claude.*` entry, read back. */
export type ClaudeRecord =
  | { kind: "user"; data: ClaudeUser }
  | { kind: "reply"; data: ClaudeReply }
  | { kind: "withdrawn"; requestIds: string[] };

/** The entry draft for an admitted message. */
export function userEntry(data: ClaudeUser): { kind: string; data: ReturnType<typeof toJson> } {
  return { kind: CLAUDE_USER_ENTRY, data: toJson(data) };
}

/** The entry draft for a turn's reply. */
export function replyEntry(data: ClaudeReply): { kind: string; data: ReturnType<typeof toJson> } {
  return { kind: CLAUDE_REPLY_ENTRY, data: toJson(data) };
}

/** The entry draft for withdrawn queued messages. */
export function withdrawnEntry(requestIds: string[]): {
  kind: string;
  data: ReturnType<typeof toJson>;
} {
  return { kind: CLAUDE_WITHDRAWN_ENTRY, data: toJson({ requestIds }) };
}

/**
 * A stored entry as a Claude plan record; undefined for any other kind.
 * Throws when a `claude.*` entry does not fit its shape.
 */
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

/** The request id a stored `claude.user` entry was admitted with. */
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

/** A parsed row: the schema checked the fields every row has; the card fields are as stored. */
function asToolCall(row: z.infer<typeof toolCallSchema>): ChatToolCall {
  return row as ChatToolCall;
}

/** Statuses a tool call ends in. Any other row was still running or waiting. */
const FINISHED_TOOL = new Set<ChatToolStatus>([
  "done",
  "error",
  "denied",
  "expired",
  "interrupted",
  "aborted",
]);

/**
 * A turn's tool rows once the turn is over: a call that had not finished is
 * cut off (`aborted` by a stop, `interrupted` otherwise, as pi shows one),
 * with nothing left of its wait (no card the owner could still answer).
 */
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

/** What the projection needs of the turn running now and of the messages waiting for one. */
export interface ClaudeLive {
  /** The running turn's reply as it stands (its text streams in memory). */
  reply?: ClaudeReply;
  /** Request ids admitted but waiting for their turn (or being withdrawn): not in the transcript. */
  queued: ReadonlySet<string>;
}

/**
 * The chat the owner sees, from the conversation's `claude.*` records in
 * entry order and what runs now. Each admitted message is its own turn, in
 * the order it was admitted: its user message, then its reply (the newest
 * entry for the turn, or the running one). A queued or withdrawn message is
 * left out. A message whose turn never ran (the app restarted first) reads
 * as unanswered, and a reply cut off mid-turn by a restart as an error. A
 * running reply shows once it has text, a tool call or an error; a finished
 * one always shows, even empty, so its request has a Finished reply.
 */
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
      // A reply with no message of its own (a pause the old engine wrote alone).
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
  // Written mid-turn and never finished: the app restarted under it.
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

// ── The one-time import of `<agent.db>.claude.json` ────────────────────────

/** A message as the old engine wrote it to its JSON file. */
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

/**
 * The entries one conversation of the old file becomes, in its order. A
 * retried message the old engine stored twice (register C1) is kept once,
 * with its first reply.
 */
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
