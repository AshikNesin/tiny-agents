import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type { EntryRecord, InboxItem, SubmissionRecord } from "@earendil-works/pi-durable";
import type {
  AttachmentRef,
  ChatAuthor,
  ChatEvent,
  ChatMessage,
  ChatPage,
  ChatState,
  ChatToolCall,
  LastMessage,
  QueuedMessage,
} from "./types";
import type { GateUserMessage } from "./policy";
import { finishedToolRow, liveToolRow, type LiveTool } from "./tool-call-row";
import { sentTextsOf } from "./toolkits/message-owner";

export interface RawChat {
  entries: readonly EntryRecord[];
  live?: AssistantMessage;
  busy: boolean;
  unanswered: ReadonlyMap<number, string>;
  tools?: ReadonlyMap<string, LiveTool>;
  queued?: readonly QueuedMessage[];
}

interface ToolResult {
  message: ToolResultMessage;
  diagnostics: { code?: string; message?: string }[];
}

export const NO_REPLY = "No reply was produced for this message.";

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

export const CHAT_USER_ENTRY = "chat.user";

export function userMessagesOf(entries: readonly EntryRecord[]): GateUserMessage[] {
  return entries
    .filter((entry) => entry.kind === "pi.user" || entry.kind === CHAT_USER_ENTRY)
    .map((entry) =>
      gateUserMessage({
        text: textOf(entry.model?.[0]?.content),
        peer: peerOf(entry),
        author: authorOf(entry),
      }),
    );
}

export function gateUserMessages(messages: readonly ChatMessage[]): GateUserMessage[] {
  return messages
    .filter((message) => message.role === "user")
    .reverse()
    .map(gateUserMessage);
}

function gateUserMessage(message: Pick<ChatMessage, "text" | "peer" | "author">): GateUserMessage {
  return {
    text: message.text,
    peer: message.peer !== undefined,
    ...(message.author ? { author: message.author.id } : {}),
  };
}

export function lastMessageOf(messages: readonly ChatMessage[]): LastMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    const text =
      message.role === "assistant" && message.error
        ? `⚠ ${message.error}`
        : message.quiet
          ? (message.sent?.at(-1) ?? "")
          : message.text;
    if (!text) continue;
    return { role: message.role, text, createdAt: message.createdAt };
  }
  return undefined;
}

function peerOf(entry: EntryRecord): ChatMessage["peer"] | undefined {
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

export function authoredText(name: string, text: string): string {
  return `${name}: ${text}`;
}

function authorOfData(data: Record<string, unknown> | undefined): ChatAuthor | undefined {
  const author = record(data?.author);
  if (!author) return undefined;
  return typeof author.id === "number" && typeof author.name === "string" && author.name
    ? { id: author.id, name: author.name }
    : undefined;
}

function authorOf(entry: EntryRecord): ChatAuthor | undefined {
  return entry.kind === CHAT_USER_ENTRY ? authorOfData(record(entry.data)) : undefined;
}

function withoutAuthor(text: string, author: ChatAuthor | undefined): string {
  if (!author) return text;
  const prefix = authoredText(author.name, "");
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function isQuietPeer(peer: ChatMessage["peer"] | undefined): boolean {
  return peer?.kind === "reply" || peer?.kind === "message";
}

export const SKIP_REPLY = "[skip]";

export function isSkipReply(message: Pick<ChatMessage, "role" | "text" | "toolCalls">): boolean {
  return (
    message.role === "assistant" &&
    message.text.trim() === SKIP_REPLY &&
    (message.toolCalls?.length ?? 0) === 0
  );
}

function requestIdOf(entry: EntryRecord): string | undefined {
  if (entry.kind !== CHAT_USER_ENTRY) return undefined;
  const requestId = record(entry.data)?.requestId;
  return typeof requestId === "string" && requestId ? requestId : undefined;
}

export function attachmentsOf(entry: EntryRecord): AttachmentRef[] | undefined {
  if (entry.kind !== CHAT_USER_ENTRY) return undefined;
  return attachmentsOfData(record(entry.data));
}

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
    const author = authorOfData(data);
    out.push({
      requestId: records.get(String(item.id))?.requestId ?? String(item.id),
      mode: item.mode,
      text: withoutAuthor(textOf(item.content), author),
      ...(attachments ? { attachments } : {}),
      ...(author ? { author } : {}),
    });
  }
  return out;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

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
    const { message, diagnostics } = result;
    return {
      ...base,
      ...finishedToolRow({
        output: textOf(message.content),
        details: message.details,
        isError: message.isError,
        ...(message.durationMs !== undefined ? { durationMs: message.durationMs } : {}),
        diagnostics,
      }),
    };
  }
  if (slot) return { ...base, ...liveToolRow(slot) };
  return { ...base, status: settled ? "interrupted" : "pending" };
}

function modelErrorText(message: Pick<AssistantMessage, "errorMessage">): string {
  return message.errorMessage || "The model returned an error.";
}

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
      list.push({ message, diagnostics });
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

function assistantToChat(
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
  const sent = sentTextsOf(toolCalls);
  return {
    id,
    role: "assistant",
    text: textOf(message.content),
    ...(reasoning ? { reasoning } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(sent.length > 0 ? { sent } : {}),
    status,
    ...(status === "error" ? { error: modelErrorText(message) } : {}),
    model: message.model,
    createdAt: message.timestamp ?? 0,
  };
}

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
  let quiet = false;
  let afterUser = false;
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
      const author = entry.kind === CHAT_USER_ENTRY ? authorOfData(record(entry.data)) : undefined;
      quiet = isQuietPeer(peer) && (quiet || !afterUser);
      afterUser = true;
      out.push({
        id: `e${entry.id}`,
        role: "user",
        text: withoutAuthor(textOf(message.content), author),
        ...(attachments ? { attachments } : {}),
        ...(requestId ? { requestId } : {}),
        ...(peer ? { peer } : {}),
        ...(author ? { author } : {}),
        status: "done",
        createdAt: message.timestamp ?? 0,
      });
      continue;
    }

    afterUser = false;
    const assistant = message as AssistantMessage;
    if (assistant.stopReason === "aborted") {
      const next = visible.slice(i + 1).find((e) => e.kind !== "pi.compaction");
      const retried = next ? next.kind === "pi.assistant" : raw.live !== undefined;
      if (retried) continue;
    }
    const reply = assistantToChat(`e${entry.id}`, assistant, false, {
      results: results.get(id),
      live: entry === lastAssistant ? raw.tools : undefined,
      settled: settled || entry !== lastAssistant,
    });
    out.push(quiet ? { ...reply, quiet: true } : reply);
  }

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
      error: (reasonCode && (UNANSWERED_REASONS[reasonCode] ?? reasonCode)) || NO_REPLY,
    };
  }

  if (raw.live) {
    const live = assistantToChat("live", raw.live, true);
    out.push(quiet ? { ...live, quiet: true } : live);
  }
  return out;
}

export function chatState(raw: RawChat): ChatState {
  return {
    messages: deriveChat(raw),
    busy: raw.busy || raw.live !== undefined,
    queued: raw.queued ?? [],
  };
}

export const CHAT_WINDOW = 60;

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

export function diffChat(prev: ChatState, next: ChatState): ChatEvent[] {
  const events: ChatEvent[] = [];
  const nextIds = new Set(next.messages.map((m) => m.id));
  const prevById = new Map(prev.messages.map((m) => [m.id, m]));

  const survivors = prev.messages.filter((m) => nextIds.has(m.id)).map((m) => m.id);
  const nextOrderOfSurvivors = next.messages.filter((m) => prevById.has(m.id)).map((m) => m.id);
  if (survivors.join(",") !== nextOrderOfSurvivors.join(",")) {
    return [{ type: "snapshot", state: next }];
  }
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
