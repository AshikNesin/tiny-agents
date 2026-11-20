import { REPORT_ROUTINE_BLOCKED } from "./toolkits/routines";
import type { ChatMessage, ChatState, ChatToolCall, FinishedReply } from "./types";

function blockedReasonOf(calls: ChatToolCall[] | undefined): string | undefined {
  const call = calls?.findLast(
    (candidate) => candidate.name === REPORT_ROUTINE_BLOCKED && candidate.status === "done",
  );
  const reason = call?.args.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
}

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

export type TurnOutcome =
  | { status: "answered"; reply: FinishedReply }
  | { status: "pending" }
  | { status: "unknown" };

export function finishedReplyTo(
  state: Pick<ChatState, "messages" | "busy" | "queued">,
  requestId: string,
): TurnOutcome {
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
  let closed = messages[start].status === "unanswered";
  for (const message of closed ? [] : messages.slice(start + 1)) {
    if (message.role === "user") {
      if (!last) continue;
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
