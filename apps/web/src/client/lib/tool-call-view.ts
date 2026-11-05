/**
 * How a tool call is shown, in one pure table. The agent reports twelve
 * tool statuses; the chat only ever asks a few questions of them: is the
 * bot still at it, is it waiting on the owner (and for what), did it fail,
 * which card or row draws it, what note goes beside it, and may it fold
 * into a run of finished steps. Every component that shows a call asks
 * `viewOf` instead of sorting statuses itself, so a new status or Owner
 * wait kind is one edit here.
 */
import type { ChatToolCall, ChatToolStatus } from "./chat-types";

/**
 * Where a call is in its life.
 * - `pending`: announced, not started yet.
 * - `running`: the tool is working.
 * - `waiting`: paused on the owner (GLOSSARY: Owner wait).
 * - `done`: finished with a result.
 * - `failed`: finished without one: an error, or refused, expired, stopped or
 *   interrupted before it could run.
 */
export type ToolPhase = "pending" | "running" | "waiting" | "done" | "failed";

/** The Owner wait a `waiting` call is paused on. */
export type WaitingOn = "approval" | "answer" | "credentials" | "takeover";

/**
 * What draws the call when it is not a plain trace line.
 * - `approval` / `vault-approval`: the owner's approval card (issue #56 for vault uses).
 * - `credentials`: the sign-in sheet's card.
 * - `takeover`: the "take over the computer" card (issue #108).
 * - `question`: the questionnaire, while it waits.
 * - `asked-questions`: the questions and answers, once it no longer waits.
 * - `bot-handoff`: a `message_bot` call's hand-off line.
 * - `code-handoff`: a coding hand-off's card (issue #143).
 */
export type ToolCard =
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
  /** `waiting` calls: what the owner is asked for. */
  waitingOn?: WaitingOn;
  /** The card that draws the call; none: a trace line. */
  card?: ToolCard;
  /** How the call ended or what it waits on, beside its line ("denied by you"). */
  note?: string;
  /** Finished and drawn as a plain trace line: runs of these fold into one step. */
  foldable: boolean;
  /** The trace line's status: spinning, a clock (waiting on you), or red. */
  trace?: "running" | "pending" | "error";
  /** The trace line's icon: a clock while waiting, a ban when it never ran. */
  icon?: "clock" | "ban";
  /**
   * What a notification's `?focus=` link scrolls to (focus-param.ts), on a
   * card the owner can answer.
   */
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
};

const TRACE: Record<ToolPhase, ToolCallView["trace"]> = {
  pending: "running",
  running: "running",
  waiting: "pending",
  done: undefined,
  failed: "error",
};

/** The card a call gets, if any; `readOnly` (a Past chat) answers nothing. */
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
  return undefined;
}

/**
 * How `call` is shown. `readOnly`: in a transcript whose cards cannot act
 * (a Past chat), what still waits is shown as not answered, without a card.
 */
export function viewOf(call: ChatToolCall, { readOnly = false } = {}): ToolCallView {
  const phase = PHASE[call.status];
  const card = cardOf(call, readOnly);
  const waitingOn = WAITING_ON[call.status];
  const anchor = anchorOf(card, call.taskId);
  let note = readOnly && phase === "waiting" ? "not answered" : NOTE[call.status];
  // Questions that ended without answers were dismissed (the owner wrote in the chat instead).
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

/** The bot is visibly at it: the call is pending, running or waiting on the owner. */
export function isActive(call: ChatToolCall): boolean {
  const { phase } = viewOf(call);
  return phase === "pending" || phase === "running" || phase === "waiting";
}
