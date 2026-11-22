import type {
  ApprovalRequest,
  QueuedMessage,
  ToolItem,
  ToolKind,
  TranscriptItem,
} from "../../contracts";
import type { PartialText } from "../../server/feed";
import { excerpt, firstLine } from "../../server/items";
import type { PiChatState, PiMessage, PiQueued, PiToolCall } from "./port";

interface OpenRequest {
  id: string;
  taskId: number;
  call: PiToolCall;
  text: string;
}

export interface PiTranscript {
  items: TranscriptItem[];
  partial: PartialText;
  requests: OpenRequest[];
  turns: number;
  endedAt: number | undefined;
}

const ASK_OWNER = "ask_owner";

const TOOL_KINDS: Record<string, ToolKind> = {
  read: "read",
  write: "edit",
  edit: "edit",
  bash: "bash",
  find: "search",
};

const STOPPED_STATUSES = new Set<PiToolCall["status"]>(["aborted"]);
const RUNNING_STATUSES = new Set<PiToolCall["status"]>([
  "pending",
  "running",
  "awaiting_approval",
  "awaiting_answer",
  "awaiting_credentials",
  "awaiting_takeover",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function summaryOf(call: PiToolCall): string {
  const { args } = call;
  switch (call.name) {
    case "bash":
      return firstLine(text(args.command));
    case "read":
    case "write":
    case "edit":
      return firstLine(text(args.path));
    case "find":
      return firstLine(text(args.query));
    default: {
      const first = Object.values(args).find((value) => typeof value === "string");
      return firstLine(text(first));
    }
  }
}

function statusOf(call: PiToolCall): ToolItem["status"] {
  if (RUNNING_STATUSES.has(call.status)) return "running";
  if (call.status === "done") return "done";
  return call.status === "denied" ? "denied" : "error";
}

function toolRow(id: string, call: PiToolCall): ToolItem {
  const status = statusOf(call);
  const exitCode = call.exitCode ?? (call.name === "bash" && status === "done" ? 0 : undefined);
  return {
    kind: "tool",
    id,
    tool: TOOL_KINDS[call.name] ?? "other",
    name: call.name,
    input: call.args,
    summary: summaryOf(call),
    status,
    ...(call.output ? { output: call.output } : {}),
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
    ...(call.diff ? { diff: call.diff } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    images: [],
  };
}

function questionRequest(call: PiToolCall): ApprovalRequest {
  return {
    kind: "question",
    questions: (call.questions ?? []).map((asked) => ({
      question: asked.question,
      ...(asked.description ? { header: asked.description } : {}),
      ...(asked.multiple ? { multiSelect: true } : {}),
      options: (asked.options ?? []).map((option) => ({
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    })),
  };
}

function toolRequest(call: PiToolCall): ApprovalRequest {
  return {
    kind: "tool",
    tool: TOOL_KINDS[call.name] ?? "other",
    name: call.name,
    input: call.args,
    summary: summaryOf(call),
  };
}

type RequestStatus = Extract<TranscriptItem, { kind: "request" }>["status"];

function requestStatus(call: PiToolCall): RequestStatus | undefined {
  if (call.name === ASK_OWNER) {
    if (call.status === "awaiting_answer") return "open";
    if (RUNNING_STATUSES.has(call.status)) return undefined;
    return call.answers ? "answered" : "expired";
  }
  if (call.status === "awaiting_approval") return "open";
  if (call.status === "expired") return "expired";
  if (call.approval === "approved") return "allowed";
  return call.approval === "denied" || call.status === "denied" ? "denied" : undefined;
}

export function requestIdOf(messageId: string, index: number): string {
  return `${messageId}:t${index}:request`;
}

function attentionText(call: PiToolCall): string {
  if (call.name === ASK_OWNER) {
    return `Native asks: ${call.questions?.[0]?.question ?? "a question"}`;
  }
  return `Native wants to use ${call.name}: ${summaryOf(call)}`;
}

function nextSpeaker(messages: readonly PiMessage[], after: number): PiMessage | undefined {
  return messages.slice(after + 1).find((message) => message.role !== "marker");
}

export function normalizeChat(state: PiChatState, stopped: ReadonlySet<string>): PiTranscript {
  const items: TranscriptItem[] = [];
  const requests: OpenRequest[] = [];
  let partial: PartialText = { text: "", thinking: "" };
  let turns = 0;
  let turnStart: number | undefined;
  let newest = 0;

  const endTurn = (message: PiMessage) => {
    const duration = turnStart === undefined ? 0 : message.createdAt - turnStart;
    items.push({
      kind: "turn",
      id: `${message.id}:turn`,
      ...(duration > 0 ? { durationMs: duration } : {}),
    });
    turns++;
    turnStart = undefined;
  };

  state.messages.forEach((message, index) => {
    newest = Math.max(newest, message.createdAt);
    if (message.role === "marker") {
      items.push({ kind: "notice", id: message.id, level: "info", text: message.text });
      return;
    }
    if (message.role === "user") {
      turnStart ??= message.createdAt;
      items.push({
        kind: "user",
        id: message.id,
        text: message.text,
        attachments: [],
        forkAt: message.id,
      });
      if (stopped.has(message.id)) {
        items.push({ kind: "notice", id: `${message.id}:stop`, level: "info", text: "Stopped." });
        endTurn(message);
      } else if (message.status === "unanswered") {
        items.push({
          kind: "notice",
          id: `${message.id}:error`,
          level: "error",
          text: excerpt(message.error ?? "No reply was produced for this message."),
          retryable: true,
        });
        endTurn(message);
      }
      return;
    }
    if (message.status === "streaming") {
      partial = { text: message.text, thinking: message.reasoning ?? "" };
      return;
    }
    const calls = message.toolCalls ?? [];
    const failed = message.status === "error";
    if (message.reasoning) {
      items.push({ kind: "thinking", id: `${message.id}:thinking`, text: message.reasoning });
    }
    if (message.text.trim() && !(failed && message.text === message.error)) {
      items.push({ kind: "assistant", id: message.id, text: message.text });
    }
    calls.forEach((call, at) => {
      if (call.name !== ASK_OWNER) items.push(toolRow(`${message.id}:t${at}`, call));
      const status = requestStatus(call);
      if (!status) return;
      const id = requestIdOf(message.id, at);
      items.push({
        kind: "request",
        id,
        request: call.name === ASK_OWNER ? questionRequest(call) : toolRequest(call),
        status,
      });
      if (status === "open" && call.taskId !== undefined) {
        requests.push({ id, taskId: call.taskId, call, text: firstLine(attentionText(call), 200) });
      }
    });
    const cut = calls.some((call) => STOPPED_STATUSES.has(call.status));
    if (failed) {
      items.push({
        kind: "notice",
        id: `${message.id}:error`,
        level: "error",
        text: excerpt(message.error ?? "The model returned an error."),
        retryable: true,
      });
    } else if (message.status === "stopped" || cut) {
      items.push({ kind: "notice", id: `${message.id}:stop`, level: "info", text: "Stopped." });
    }
    const next = nextSpeaker(state.messages, index);
    const final = calls.length === 0 || failed || cut || message.status === "stopped";
    if (final || (next === undefined && !state.busy)) endTurn(message);
  });

  return {
    items,
    partial,
    requests,
    turns,
    endedAt: state.busy || newest <= 0 ? undefined : newest,
  };
}

export function queuedOf(queued: readonly PiQueued[], now: Date): QueuedMessage[] {
  return queued.map((item) => ({
    id: item.requestId,
    text: item.text,
    createdAt: new Date(item.createdAt ?? now).toISOString(),
  }));
}
