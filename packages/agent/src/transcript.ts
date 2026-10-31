import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type { EntryRecord, InboxItem, SubmissionRecord } from "@earendil-works/pi-durable";
import type {
  AttachmentRef,
  ChatEvent,
  ChatMessage,
  ChatPage,
  ChatState,
  ChatToolCall,
  ChatCredentialRequest,
  ChatToolStatus,
  ChatVaultUse,
  OwnerAnswer,
  OwnerQuestion,
  QueuedMessage,
} from "./types";
import { secretRedactor } from "./redact";

/** A tool call of the current round, as `pi.live` presents it. */
export interface LiveTool {
  status: "pending" | "running" | "done";
  taskId?: number;
  output?: string;
  details?: unknown;
}

/** Raw pieces of a conversation the chat view is derived from. */
export interface RawChat {
  /** Every stored entry (full history, not just the model's active context), ascending by id. */
  entries: readonly EntryRecord[];
  /** The reply currently being generated, if any. */
  live?: AssistantMessage;
  busy: boolean;
  /** Failure reasons for inputs that settled without an answer, by user entry id. */
  unanswered: ReadonlyMap<number, string>;
  /** Tool calls of the current round, by provider call id. */
  tools?: ReadonlyMap<string, LiveTool>;
  /** Owner inputs queued behind (or steering into) the running reply. */
  queued?: readonly QueuedMessage[];
}

/** Longest tool output kept for the user. */
const MAX_TOOL_OUTPUT = 4000;

interface ToolResult {
  message: ToolResultMessage;
  codes: string[];
  diagnostics: string[];
}

const UNANSWERED_REASONS: Record<string, string> = {
  no_model: "This bot's model is not available. Pick another model.",
  aborted: "Stopped before a reply started.",
  model_error: "The model returned an error.",
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => block?.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Entry kind a chat send is placed as (pi-durable InputEntry; not "pi."-prefixed). */
export const CHAT_USER_ENTRY = "chat.user";

/** Trusted peer attribution stored in a `chat.user` entry's data. */
export function peerOf(entry: EntryRecord): ChatMessage["peer"] | undefined {
  if (entry.kind !== CHAT_USER_ENTRY) return undefined;
  const data = record(entry.data);
  const peer = record(data?.peer);
  if (!peer) return undefined;
  if (peer.kind === "reply" || peer.kind === "message") {
    return typeof peer.name === "string" && peer.name
      ? { kind: peer.kind, name: peer.name }
      : undefined;
  }
  if (peer.kind === "mention") {
    return typeof peer.hostName === "string" && peer.hostName
      ? { kind: "mention", hostName: peer.hostName }
      : undefined;
  }
  return undefined;
}

/** The submit request id stored in a `chat.user` entry's data. */
function requestIdOf(entry: EntryRecord): string | undefined {
  if (entry.kind !== CHAT_USER_ENTRY) return undefined;
  const requestId = record(entry.data)?.requestId;
  return typeof requestId === "string" && requestId ? requestId : undefined;
}

/** Attachment refs stored in a `chat.user` entry's data (validated at upload). */
export function attachmentsOf(entry: EntryRecord): AttachmentRef[] | undefined {
  if (entry.kind !== CHAT_USER_ENTRY) return undefined;
  return attachmentsOfData(record(entry.data));
}

/** Attachment refs of any entry data object: an inbox item's entry is plain JSON. */
function attachmentsOfData(data: Record<string, unknown> | undefined): AttachmentRef[] | undefined {
  const list = Array.isArray(data?.attachments) ? data.attachments : [];
  const refs = list.filter(
    (a): a is AttachmentRef =>
      record(a) !== undefined &&
      typeof a.uploadId === "string" &&
      (a.kind === "image" || a.kind === "file") &&
      typeof a.name === "string" &&
      typeof a.mimeType === "string" &&
      typeof a.size === "number",
  );
  return refs.length > 0 ? refs : undefined;
}

/**
 * Owner messages of a conversation's inbox (pi-durable's queued submissions).
 * Steers and follow-ups whose entry carries no peer attribution render as
 * queued bubbles; write submissions (compaction summaries) and cross-bot
 * deliveries (peer entries) do not.
 */
export function queuedOf(
  items: readonly InboxItem[],
  records: ReadonlyMap<string, SubmissionRecord>,
): QueuedMessage[] {
  const out: QueuedMessage[] = [];
  for (const item of items) {
    if (item.mode === "write") continue;
    const data = record(record(item.entry)?.data);
    if (data?.peer) continue;
    const attachments = attachmentsOfData(data);
    out.push({
      requestId: records.get(String(item.id))?.requestId ?? String(item.id),
      mode: item.mode,
      text: textOf(item.content),
      ...(attachments ? { attachments } : {}),
    });
  }
  return out;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Bounded, and scrubbed of vault values (a backstop: the gate already scrubbed results). */
function clip(raw: string): string {
  const text = secretRedactor.scrub(raw);
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}…` : text;
}

function sourcesOf(details: unknown): ChatToolCall["sources"] {
  const sources = record(details)?.sources ?? record(record(details)?.result)?.sources;
  if (!Array.isArray(sources)) return undefined;
  const valid = sources.filter(
    (s): s is { url: string; title: string } =>
      typeof s?.url === "string" && typeof s?.title === "string",
  );
  return valid.length > 0 ? valid.map(({ url, title }) => ({ url, title })) : undefined;
}

/** An `ask_owner` call's details (under `result` when the approval gate asked first). */
function questionsOf(
  details: unknown,
): Pick<ChatToolCall, "questions" | "answers"> & { pending: boolean } {
  const own = record(details);
  const value = own?.question !== undefined ? own : record(own?.result);
  if (!value || !Array.isArray(value.questions)) return { pending: false };
  return {
    pending: value.question === "pending",
    questions: value.questions as OwnerQuestion[],
    ...(Array.isArray(value.answers) ? { answers: value.answers as OwnerAnswer[] } : {}),
  };
}

/** A vault sink's card (on the pending details only). */
function vaultOf(details: unknown): ChatVaultUse | undefined {
  const vault = record(record(details)?.vault);
  return vault && typeof vault.handle === "string" ? (vault as unknown as ChatVaultUse) : undefined;
}

/** A `request_credentials` call's details (under `result` when the approval gate asked first). */
function credentialsOf(details: unknown): ChatCredentialRequest | undefined {
  const own = record(details);
  const value = own?.credentials !== undefined ? own : record(own?.result);
  const request = record(value?.request);
  if (!value || typeof value.credentials !== "string" || !request) return undefined;
  return {
    status: value.credentials as ChatCredentialRequest["status"],
    origin: String(request.origin ?? ""),
    title: String(request.title ?? ""),
    purpose: String(request.purpose ?? ""),
    fields: (Array.isArray(request.fields) ? request.fields : []).map((field) => {
      const f = record(field) ?? {};
      return {
        key: String(f.key ?? ""),
        label: String(f.label ?? ""),
        type: String(f.type ?? "text"),
        required: f.required === true,
      };
    }),
    ...(Array.isArray(value.filled) ? { filled: value.filled.map(String) } : {}),
    ...(typeof value.savedHandle === "string" ? { savedHandle: value.savedHandle } : {}),
  };
}

function expiresAtOf(details: unknown): number | undefined {
  const at = record(details)?.expiresAt;
  return typeof at === "number" ? at : undefined;
}

function resultStatus(result: ToolResult): ChatToolStatus {
  const details = record(result.message.details);
  if (details?.approval === "denied") return "denied";
  if (details?.approval === "expired" || details?.credentials === "expired") return "expired";
  if (details?.interrupted === true || result.codes.includes("interrupted")) return "interrupted";
  if (result.codes.includes("aborted")) return "aborted";
  return result.message.isError ? "error" : "done";
}

/** A tool call merged with its stored result, else with its live slot. */
function toolCallView(
  call: ToolCall,
  result: ToolResult | undefined,
  slot: LiveTool | undefined,
  settled: boolean,
): ChatToolCall {
  const base: ChatToolCall = {
    id: call.id,
    name: call.name,
    args: (call.arguments as Record<string, unknown>) ?? {},
    status: "pending",
  };
  if (result) {
    const message = result.message;
    const output = textOf(message.content) || result.diagnostics.join("\n");
    const details = record(message.details);
    const approval = details?.approval;
    const sources = sourcesOf(message.details);
    const { questions, answers } = questionsOf(message.details);
    const credentials = credentialsOf(message.details);
    // The tool's clock includes any wait for the owner's approval: report
    // the run and the wait apart.
    const waitedMs = typeof details?.waitedMs === "number" ? details.waitedMs : undefined;
    return {
      ...base,
      status: resultStatus(result),
      ...(output ? { output: clip(output) } : {}),
      ...(message.durationMs !== undefined
        ? { durationMs: Math.max(0, message.durationMs - (waitedMs ?? 0)) }
        : {}),
      ...(waitedMs ? { waitedMs } : {}),
      ...(approval === "approved" ||
      approval === "denied" ||
      approval === "auto" ||
      approval === "refused"
        ? { approval }
        : {}),
      ...(sources ? { sources } : {}),
      ...(questions ? { questions } : {}),
      ...(answers ? { answers } : {}),
      ...(credentials ? { credentials } : {}),
    };
  }
  if (slot) {
    const waiting = record(slot.details)?.approval === "pending";
    const asked = questionsOf(slot.details);
    const credentials = credentialsOf(slot.details);
    const vault = waiting ? vaultOf(slot.details) : undefined;
    const expiresAt = expiresAtOf(slot.details);
    return {
      ...base,
      status: waiting
        ? "awaiting_approval"
        : asked.pending
          ? "awaiting_answer"
          : credentials?.status === "pending"
            ? "awaiting_credentials"
            : slot.status === "running"
              ? "running"
              : "pending",
      ...(slot.taskId !== undefined ? { taskId: slot.taskId } : {}),
      ...(slot.output ? { output: clip(slot.output) } : {}),
      ...(asked.pending ? { questions: asked.questions } : {}),
      ...(vault ? { vault } : {}),
      ...(credentials ? { credentials } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }
  // No result and no live slot: still queued in a busy run, or cut off for good.
  return { ...base, status: settled ? "interrupted" : "pending" };
}

/** Tool results stored after each assistant entry, by provider call id (in order, for duplicate ids). */
function toolResultsByAssistant(entries: readonly EntryRecord[]): Map<number, ToolResult[]> {
  const out = new Map<number, ToolResult[]>();
  let assistant: number | undefined;
  for (const entry of entries) {
    if (entry.kind === "pi.assistant") assistant = Number(entry.id);
    else if (entry.kind === "pi.tool-result" && assistant !== undefined) {
      const message = entry.model?.[0];
      if (message?.role !== "toolResult") continue;
      const diagnostics = (record(entry.data)?.diagnostics ?? []) as {
        code?: string;
        message?: string;
      }[];
      const list = out.get(assistant) ?? [];
      list.push({
        message,
        codes: diagnostics.map((d) => d.code ?? ""),
        diagnostics: diagnostics.map((d) => d.message ?? "").filter(Boolean),
      });
      out.set(assistant, list);
    } else if (entry.kind === "pi.user" || entry.kind === CHAT_USER_ENTRY) assistant = undefined;
  }
  return out;
}

function toolCallsOf(
  message: AssistantMessage,
  results: ToolResult[] = [],
  tools: ReadonlyMap<string, LiveTool> | undefined,
  settled: boolean,
): ChatToolCall[] {
  const unmatched = [...results];
  return message.content
    .filter((block): block is ToolCall => block.type === "toolCall")
    .map((call) => {
      const index = unmatched.findIndex((r) => r.message.toolCallId === call.id);
      const result = index >= 0 ? unmatched.splice(index, 1)[0] : undefined;
      return toolCallView(call, result, result ? undefined : tools?.get(call.id), settled);
    });
}

function thinkingOf(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "thinking"; thinking: string } => block.type === "thinking")
    .map((block) => block.thinking)
    .join("\n\n");
}

function firstMessage(entry: EntryRecord): Message | undefined {
  return entry.model?.[0];
}

export function assistantToChat(
  id: string,
  message: AssistantMessage,
  streaming = false,
  tools?: { results?: ToolResult[]; live?: ReadonlyMap<string, LiveTool>; settled: boolean },
): ChatMessage {
  const reasoning = thinkingOf(message);
  const status = streaming
    ? "streaming"
    : message.stopReason === "aborted"
      ? "stopped"
      : message.stopReason === "error"
        ? "error"
        : "done";
  const toolCalls = toolCallsOf(message, tools?.results, tools?.live, tools?.settled ?? !streaming);
  return {
    id,
    role: "assistant",
    text: textOf(message.content),
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    status,
    ...(status === "error"
      ? { error: message.errorMessage || "The model returned an error." }
      : {}),
    model: message.model,
    createdAt: message.timestamp ?? 0,
  };
}

/**
 * Derive the chat transcript shown to the user from raw durable state.
 *
 * - User and assistant entries become messages; system/tool/reset entries are hidden.
 * - A reply cut off by a restart is stored as an `aborted` assistant entry and then
 *   regenerated; the cut-off copy is hidden so the user never sees a duplicate.
 * - A compaction entry becomes an "earlier messages summarized" marker placed before
 *   the first entry it kept (everything above it was summarized for the model).
 * - An input that settled without an answer is flagged `unanswered`.
 */
export function deriveChat(raw: RawChat): ChatMessage[] {
  const entries = [...raw.entries].sort((a, b) => Number(a.id) - Number(b.id));
  const visibleKinds = new Set(["pi.user", CHAT_USER_ENTRY, "pi.assistant", "pi.compaction"]);
  const visible = entries.filter((e) => visibleKinds.has(e.kind));

  const markersBeforeHead = new Map<number, ChatMessage[]>();
  const ids = new Set(visible.map((e) => Number(e.id)));
  const out: ChatMessage[] = [];
  const results = toolResultsByAssistant(entries);
  const lastAssistant = [...visible].reverse().find((e) => e.kind === "pi.assistant");
  const settled = !raw.busy && raw.live === undefined;

  for (const entry of visible) {
    if (entry.kind !== "pi.compaction") continue;
    const marker: ChatMessage = {
      id: `e${entry.id}`,
      role: "marker",
      marker: "compaction",
      text: "Earlier messages summarized",
      status: "done",
      createdAt: 0,
    };
    const head = entry.head !== undefined ? Number(entry.head) : undefined;
    if (head !== undefined && ids.has(head) && head !== Number(entry.id)) {
      const list = markersBeforeHead.get(head) ?? [];
      list.push(marker);
      markersBeforeHead.set(head, list);
    }
  }
  for (let i = 0; i < visible.length; i++) {
    const entry = visible[i];
    const id = Number(entry.id);
    const before = markersBeforeHead.get(id);
    if (before) out.push(...before);

    if (entry.kind === "pi.compaction") {
      const head = entry.head !== undefined ? Number(entry.head) : undefined;
      if (head === undefined || !ids.has(head) || head === id) {
        out.push({
          id: `e${entry.id}`,
          role: "marker",
          marker: "compaction",
          text: "Earlier messages summarized",
          status: "done",
          createdAt: 0,
        });
      }
      continue;
    }

    const message = firstMessage(entry);
    if (!message) continue;

    if (entry.kind === "pi.user" || entry.kind === CHAT_USER_ENTRY) {
      const attachments = attachmentsOf(entry);
      const peer = peerOf(entry);
      const requestId = requestIdOf(entry);
      out.push({
        id: `e${entry.id}`,
        role: "user",
        text: textOf(message.content),
        ...(attachments ? { attachments } : {}),
        ...(requestId ? { requestId } : {}),
        ...(peer ? { peer } : {}),
        status: "done",
        createdAt: message.timestamp ?? 0,
      });
      continue;
    }

    // pi.assistant
    const assistant = message as AssistantMessage;
    if (assistant.stopReason === "aborted") {
      const next = visible.slice(i + 1).find((e) => e.kind !== "pi.compaction");
      const retried = next ? next.kind === "pi.assistant" : raw.live !== undefined;
      if (retried) continue;
    }
    out.push(
      assistantToChat(`e${entry.id}`, assistant, false, {
        results: results.get(id),
        // Live slots belong to the current round: the newest assistant entry.
        live: entry === lastAssistant ? raw.tools : undefined,
        settled: settled || entry !== lastAssistant,
      }),
    );
  }

  // Flag inputs that never got an answer. Inputs that landed in the same turn
  // (a queued message plus a steer) sit back to back and share one reply, so
  // a run of user messages counts as answered when an assistant reply follows
  // it; only a settlement the runtime recorded flags one inside the run.
  for (let i = 0; i < out.length; i++) {
    const message = out[i];
    if (message.role !== "user") continue;
    const next = out.slice(i + 1).find((m) => m.role !== "marker");
    if (next?.role === "assistant") continue;
    const reasonCode = raw.unanswered.get(Number(message.id.slice(1)));
    const reply = out.slice(i + 1).find((m) => m.role !== "marker" && m.role !== "user");
    if (!reasonCode && reply?.role === "assistant") continue;
    if (reply === undefined && (raw.busy || raw.live)) continue;
    out[i] = {
      ...message,
      status: "unanswered",
      error:
        (reasonCode && (UNANSWERED_REASONS[reasonCode] ?? reasonCode)) ||
        "No reply was produced for this message.",
    };
  }

  if (raw.live) out.push(assistantToChat("live", raw.live, true));
  return out;
}

export function chatState(raw: RawChat): ChatState {
  return {
    messages: deriveChat(raw),
    busy: raw.busy || raw.live !== undefined,
    queued: raw.queued ?? [],
  };
}

/** Messages a chat stream's snapshot carries: the newest ones (issue #92). */
export const CHAT_WINDOW = 60;

/**
 * A full chat state cut down to its newest `size` messages, or to every
 * message from id `from` on (a stream keeps its window's start fixed, so
 * new messages extend it instead of pushing older ones out). Slice a state
 * derived from the full raw history: the `unanswered` flags and tool
 * statuses then stay right at the window's edge. Undefined when `from` is
 * gone from the transcript.
 */
export function windowChat(state: ChatState, size: number, from?: string): ChatState | undefined {
  let start = Math.max(0, state.messages.length - size);
  if (from !== undefined) {
    start = state.messages.findIndex((m) => m.id === from);
    if (start < 0) return undefined;
  }
  const messages = state.messages.slice(start);
  return {
    ...state,
    messages,
    hasMore: start > 0,
    ...(messages[0] ? { cursor: messages[0].id } : {}),
  };
}

/**
 * Up to `limit` messages just before message id `before`, for loading
 * history above a window. Undefined when `before` is not in the transcript.
 */
export function pageBefore(
  messages: readonly ChatMessage[],
  before: string,
  limit: number,
): ChatPage | undefined {
  const end = messages.findIndex((m) => m.id === before);
  if (end < 0) return undefined;
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), hasMore: start > 0 };
}

function sameExceptText(a: ChatMessage, b: ChatMessage): boolean {
  const { text: _ta, reasoning: _ra, ...restA } = a;
  const { text: _tb, reasoning: _rb, ...restB } = b;
  return JSON.stringify(restA) === JSON.stringify(restB);
}

/**
 * Minimal event list turning `prev` into `next`. Falls back to a snapshot when the
 * order of surviving messages changed (never expected in practice).
 */
export function diffChat(prev: ChatState, next: ChatState): ChatEvent[] {
  const events: ChatEvent[] = [];
  const nextIds = new Set(next.messages.map((m) => m.id));
  const prevById = new Map(prev.messages.map((m) => [m.id, m]));

  const survivors = prev.messages.filter((m) => nextIds.has(m.id)).map((m) => m.id);
  const nextOrderOfSurvivors = next.messages.filter((m) => prevById.has(m.id)).map((m) => m.id);
  if (survivors.join(",") !== nextOrderOfSurvivors.join(",")) {
    return [{ type: "snapshot", state: next }];
  }
  // New messages must only be appended after every survivor.
  const lastSurvivorIndex = Math.max(
    -1,
    ...next.messages.map((m, i) => (prevById.has(m.id) ? i : -1)),
  );
  const insertedInMiddle = next.messages.some(
    (m, i) => !prevById.has(m.id) && i < lastSurvivorIndex,
  );
  if (insertedInMiddle) return [{ type: "snapshot", state: next }];

  for (const m of prev.messages) {
    if (!nextIds.has(m.id)) events.push({ type: "remove", id: m.id });
  }
  for (const m of next.messages) {
    const before = prevById.get(m.id);
    if (!before) {
      events.push({ type: "upsert", message: m });
      continue;
    }
    if (JSON.stringify(before) === JSON.stringify(m)) continue;
    const textGrew = m.text.startsWith(before.text);
    const reasoningGrew = (m.reasoning ?? "").startsWith(before.reasoning ?? "");
    if (textGrew && reasoningGrew && sameExceptText(before, m)) {
      const text = m.text.slice(before.text.length);
      const reasoning = (m.reasoning ?? "").slice((before.reasoning ?? "").length);
      events.push({
        type: "delta",
        id: m.id,
        ...(text ? { text } : {}),
        ...(reasoning ? { reasoning } : {}),
      });
    } else {
      events.push({ type: "upsert", message: m });
    }
  }
  if (prev.busy !== next.busy) events.push({ type: "busy", busy: next.busy });
  if (JSON.stringify(prev.queued) !== JSON.stringify(next.queued)) {
    events.push({ type: "queued", items: next.queued });
  }
  return events;
}
