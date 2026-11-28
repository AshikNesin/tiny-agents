import type { CodingSdkMessage } from "./coding-sdk";
import type { InputItem } from "./coding-input";
import { roundCost, type UsageTotals } from "./coding-usage";

export interface TurnState {
  startedAt: number;
  firstInput?: InputItem;
  activity: boolean;
  stopRequested: boolean;
  stopBeforeActivity: boolean;
  usageLimit?: { reason: string; resetsAt?: string };
  cancelStopTimer?: () => void;
}

export function newTurn(startedAt: number, activity: boolean): TurnState {
  return { startedAt, activity, stopRequested: false, stopBeforeActivity: false };
}

export function resetsAtOf(value: unknown): { resetsAt?: string } {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return {};
  const ms = value < 1e12 ? value * 1000 : value;
  return { resetsAt: new Date(ms).toISOString() };
}

interface EntryContext {
  afterUuid: string | undefined;
  now: () => number;
}

export function resultEntry(
  message: CodingSdkMessage,
  turn: TurnState | undefined,
  context: EntryContext & { turnCost: number; turnUsage: UsageTotals | undefined },
): CodingSdkMessage {
  const { turnCost, turnUsage } = context;
  const startedAt = turn?.startedAt;
  return {
    ...message,
    turn_cost_usd: roundCost(turnCost),
    ...(turnUsage ? { turn_model_usage: turnUsage } : {}),
    ...(context.afterUuid ? { after_uuid: context.afterUuid } : {}),
    ...(typeof message.duration_ms !== "number" && startedAt !== undefined
      ? { duration_ms: context.now() - startedAt }
      : {}),
    ...(turn?.usageLimit ? { usage_limit: turn.usageLimit } : {}),
    ...(turn?.stopRequested && !turn.usageLimit ? { interrupted: true } : {}),
  };
}

export function syntheticResultEntry(
  outcome: { error?: string; interrupted?: boolean },
  turn: TurnState | undefined,
  context: EntryContext & { uuid: string; sessionId: string; totalCost: number },
): CodingSdkMessage {
  const usageLimit = turn?.usageLimit;
  return {
    type: "result",
    subtype: outcome.error ? "error_during_execution" : "success",
    synthetic: true,
    uuid: context.uuid,
    session_id: context.sessionId,
    is_error: !!outcome.error,
    ...(outcome.error ? { errors: [outcome.error] } : { result: "" }),
    duration_ms: turn ? context.now() - turn.startedAt : 0,
    num_turns: 0,
    total_cost_usd: context.totalCost,
    turn_cost_usd: 0,
    ...(context.afterUuid ? { after_uuid: context.afterUuid } : {}),
    ...(usageLimit ? { usage_limit: usageLimit } : {}),
    ...(outcome.interrupted ? { interrupted: true } : {}),
  };
}

export function stoppedEarlyError(failure: unknown, stderrTail: string): string {
  const detail = failure instanceof Error ? failure.message : failure ? String(failure) : undefined;
  const stderr = stderrTail.trim().split("\n").slice(-3).join("\n");
  return (
    detail ||
    (stderr
      ? `Claude Code stopped before the turn finished: ${stderr}`
      : "Claude Code stopped before the turn finished.")
  );
}

export function noticeEntry(uuid: string, sessionId: string, text: string): CodingSdkMessage {
  return {
    type: "system",
    subtype: "tiny_notice",
    uuid,
    session_id: sessionId,
    level: "error",
    content: text,
  };
}
