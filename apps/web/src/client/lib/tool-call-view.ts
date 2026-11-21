import type { ChatToolCall, ChatToolStatus } from "./chat-types";

export type ToolPhase = "pending" | "running" | "waiting" | "done" | "failed";

type WaitingOn = "approval" | "answer" | "credentials" | "takeover";

type ToolCard =
  | "approval"
  | "vault-approval"
  | "credentials"
  | "takeover"
  | "question"
  | "asked-questions"
  | "bot-handoff"
  | "code-handoff";

export interface ToolCallView {
  phase: ToolPhase;
  waitingOn?: WaitingOn;
  card?: ToolCard;
  note?: string;
  foldable: boolean;
  trace?: "running" | "pending" | "error";
  icon?: "clock" | "ban";
  anchor?: string;
}

const PHASE: Record<ChatToolStatus, ToolPhase> = {
  pending: "pending",
  running: "running",
  awaiting_approval: "waiting",
  awaiting_answer: "waiting",
  awaiting_credentials: "waiting",
  awaiting_takeover: "waiting",
  done: "done",
  error: "failed",
  denied: "failed",
  expired: "failed",
  aborted: "failed",
  interrupted: "failed",
};

const WAITING_ON: Partial<Record<ChatToolStatus, WaitingOn>> = {
  awaiting_approval: "approval",
  awaiting_answer: "answer",
  awaiting_credentials: "credentials",
  awaiting_takeover: "takeover",
};

const NOTE: Partial<Record<ChatToolStatus, string>> = {
  awaiting_approval: "waiting for your approval",
  awaiting_answer: "waiting for your answers",
  awaiting_credentials: "waiting for you to sign in",
  awaiting_takeover: "waiting for you on the computer",
  expired: "nobody answered in time",
  interrupted: "interrupted by a restart",
  aborted: "stopped",
  denied: "denied by you",
  error: "failed",
};

const TRACE: Record<ToolPhase, ToolCallView["trace"]> = {
  pending: "running",
  running: "running",
  waiting: "pending",
  done: undefined,
  failed: "error",
};

function cardOf(call: ChatToolCall, readOnly: boolean): ToolCard | undefined {
  const askable = !readOnly && call.taskId !== undefined;
  if (askable && call.status === "awaiting_approval") {
    return call.vault ? "vault-approval" : "approval";
  }
  if (askable && call.status === "awaiting_credentials" && call.credentials) return "credentials";
  if (!readOnly && call.status === "awaiting_takeover" && call.takeover) return "takeover";
  if (call.questions) {
    return askable && call.status === "awaiting_answer" ? "question" : "asked-questions";
  }
  if (call.name === "message_bot") return "bot-handoff";
  if (call.code) return "code-handoff";
  return undefined;
}

function anchorOf(card: ToolCard | undefined, taskId: number | undefined): string | undefined {
  if (taskId === undefined) return undefined;
  if (card === "approval" || card === "vault-approval") return `approval:${taskId}`;
  if (card === "question") return `question:${taskId}`;
  if (card === "takeover") return `takeover:${taskId}`;
  if (card === "credentials") return `credentials:${taskId}`;
  return undefined;
}

export function viewOf(call: ChatToolCall, { readOnly = false } = {}): ToolCallView {
  const phase = PHASE[call.status];
  const card = cardOf(call, readOnly);
  const waitingOn = WAITING_ON[call.status];
  const anchor = anchorOf(card, call.taskId);
  let note = readOnly && phase === "waiting" ? "not answered" : NOTE[call.status];
  if (card === "asked-questions" && note === undefined && !call.answers) note = "dismissed by you";
  const icon =
    phase === "waiting"
      ? "clock"
      : phase === "failed" && call.status !== "error"
        ? "ban"
        : undefined;
  return {
    phase,
    ...(waitingOn ? { waitingOn } : {}),
    ...(card ? { card } : {}),
    ...(note ? { note } : {}),
    foldable: (phase === "done" || phase === "failed") && card === undefined,
    ...(TRACE[phase] ? { trace: TRACE[phase] } : {}),
    ...(icon ? { icon } : {}),
    ...(anchor ? { anchor } : {}),
  };
}

export function isActive(call: ChatToolCall): boolean {
  const { phase } = viewOf(call);
  return phase === "pending" || phase === "running" || phase === "waiting";
}
