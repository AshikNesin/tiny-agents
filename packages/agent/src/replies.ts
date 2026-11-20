/**
 * Finished replies: which assistant messages answer what. A turn starts at a
 * user message and runs until the next one; every assistant message in
 * between belongs to it (a tool-calling turn writes several). The Finished
 * reply to a submission is found by the submission's request id, never by
 * timestamps, so a mid-turn "Let me check…" never stands in for the answer
 * and a queued second submission never takes the first one's reply.
 */
import { REPORT_ROUTINE_BLOCKED } from "./toolkits/routines";
import type { ChatMessage, ChatState, ChatToolCall, FinishedReply } from "./types";

/** The reason a message's finished `report_routine_blocked` call gave, if it made one (issue #87). */
function blockedReasonOf(calls: ChatToolCall[] | undefined): string | undefined {
  const call = calls?.findLast(
    (candidate) => candidate.name === REPORT_ROUTINE_BLOCKED && candidate.status === "done",
  );
  const reason = call?.args.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
}

/**
 * One finished assistant message as a reply, or undefined when it carries
 * nothing a reader acts on (a bare tool-call round) or is still streaming.
 */
export function finishedReplyOf(message: ChatMessage): FinishedReply | undefined {
  if (message.role !== "assistant" || message.status === "streaming") return undefined;
  const error = message.status === "error" ? message.error : undefined;
  const refused = message.toolCalls
    ?.filter((call) => call.approval === "refused")
    .map((call) => call.name);
  const blocked = blockedReasonOf(message.toolCalls);
  const stoppedBy = message.toolCalls?.findLast((call) => call.limit)?.limit;
  const sent = message.sent;
  if (
    !message.text &&
    !sent?.length &&
    error === undefined &&
    !refused?.length &&
    blocked === undefined &&
    stoppedBy === undefined
  ) {
    return undefined;
  }
  return {
    text: message.text,
    createdAt: message.createdAt,
    ...(error !== undefined ? { error } : {}),
    ...(refused?.length ? { refused } : {}),
    ...(blocked !== undefined ? { blocked } : {}),
    ...(stoppedBy !== undefined ? { stoppedBy } : {}),
    ...(sent?.length ? { sent } : {}),
  };
}

/**
 * What a submission's turn came to, read from a conversation's chat state:
 * - `answered`: the turn's reply. Text and error come from its last message
 *   that has text or an error; `refused` collects every tool refused anywhere
 *   in the turn, `sent` every `message_owner` text in order, `blocked` is the newest reason given and `stoppedBy` the
 *   newest run limit the gate refused a call on. A turn that said
 *   nothing at all answers with empty text.
 * - `pending`: not finished yet: the conversation is busy, the submission
 *   still waits in the inbox, or no assistant message follows it yet.
 * - `unknown`: no user message with this request id in the transcript (it
 *   went to another conversation, or predates request ids on entries).
 */
export type TurnOutcome =
  | { status: "answered"; reply: FinishedReply }
  | { status: "pending" }
  | { status: "unknown" };

export function finishedReplyTo(
  state: Pick<ChatState, "messages" | "busy" | "queued">,
  requestId: string,
): TurnOutcome {
  // A reply still running is not finished: the next idle reads it whole.
  if (state.busy || state.queued.some((item) => item.requestId === requestId)) {
    return { status: "pending" };
  }
  const { messages } = state;
  const start = messages.findIndex(
    (message) => message.role === "user" && message.requestId === requestId,
  );
  if (start === -1) return { status: "unknown" };

  let last: ChatMessage | undefined;
  let answer: FinishedReply | undefined;
  const refused = new Set<string>();
  let blocked: string | undefined;
  let stoppedBy: FinishedReply["stoppedBy"];
  const sent: string[] = [];
  let closed = false;
  for (const message of messages.slice(start + 1)) {
    if (message.role === "user") {
      closed = true;
      break;
    }
    if (message.role !== "assistant") continue;
    last = message;
    const reply = finishedReplyOf(message);
    if (!reply) continue;
    for (const name of reply.refused ?? []) refused.add(name);
    if (reply.blocked !== undefined) blocked = reply.blocked;
    if (reply.stoppedBy !== undefined) stoppedBy = reply.stoppedBy;
    if (reply.sent) sent.push(...reply.sent);
    if (reply.text || reply.error !== undefined) answer = reply;
  }
  if (!last && !closed) return { status: "pending" };

  const base: FinishedReply = answer ?? {
    text: "",
    createdAt: last?.createdAt ?? messages[start].createdAt,
  };
  const {
    refused: _refused,
    blocked: _blocked,
    stoppedBy: _stoppedBy,
    sent: _sent,
    ...rest
  } = base;
  return {
    status: "answered",
    reply: {
      ...rest,
      ...(refused.size > 0 ? { refused: [...refused] } : {}),
      ...(blocked !== undefined ? { blocked } : {}),
      ...(stoppedBy !== undefined ? { stoppedBy } : {}),
      ...(sent.length > 0 ? { sent } : {}),
    },
  };
}
