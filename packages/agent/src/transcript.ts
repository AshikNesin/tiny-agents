import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { ChatEvent, ChatMessage, ChatState } from "./types";

/** Raw pieces of a conversation the chat view is derived from. */
export interface RawChat {
  /** Every stored entry (full history, not just the model's active context), ascending by id. */
  entries: readonly EntryRecord[];
  /** The reply currently being generated, if any. */
  live?: AssistantMessage;
  busy: boolean;
  /** Failure reasons for inputs that settled without an answer, by user entry id. */
  unanswered: ReadonlyMap<number, string>;
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

function toolCallsOf(message: AssistantMessage): { name: string; summary: string }[] {
  return message.content
    .filter((block): block is ToolCall => block.type === "toolCall")
    .map((block) => ({
      name: block.name,
      summary: summarizeArgs(block.name, block.arguments as Record<string, unknown>),
    }));
}

/** One short phrase per tool: "Ship the feature" for creates, the id otherwise. */
function summarizeArgs(name: string, args: Record<string, unknown>): string {
  if (typeof args?.title === "string") return args.title;
  if (typeof args?.id === "string") return args.id;
  if (typeof args?.status === "string") return `status: ${args.status}`;
  return "";
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
): ChatMessage {
  const reasoning = thinkingOf(message);
  const status = streaming
    ? "streaming"
    : message.stopReason === "aborted"
      ? "stopped"
      : message.stopReason === "error"
        ? "error"
        : "done";
  const toolCalls = toolCallsOf(message);
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
  const visible = entries.filter(
    (e) => e.kind === "pi.user" || e.kind === "pi.assistant" || e.kind === "pi.compaction",
  );

  const markersBeforeHead = new Map<number, ChatMessage[]>();
  const ids = new Set(visible.map((e) => Number(e.id)));
  const out: ChatMessage[] = [];

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

    if (entry.kind === "pi.user") {
      out.push({
        id: `e${entry.id}`,
        role: "user",
        text: textOf(message.content),
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
    out.push(assistantToChat(`e${entry.id}`, assistant));
  }

  // Flag inputs that never got an answer.
  for (let i = 0; i < out.length; i++) {
    const message = out[i];
    if (message.role !== "user") continue;
    const next = out.slice(i + 1).find((m) => m.role !== "marker");
    if (next?.role === "assistant") continue;
    const isLast = next === undefined;
    if (isLast && (raw.busy || raw.live)) continue;
    const reasonCode = raw.unanswered.get(Number(message.id.slice(1)));
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
  return { messages: deriveChat(raw), busy: raw.busy || raw.live !== undefined };
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
  return events;
}
