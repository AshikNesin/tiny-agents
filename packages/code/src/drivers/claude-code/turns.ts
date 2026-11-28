import type { IndexedThread } from "../../contracts";
import { excerpt, record } from "../../server/items";
import type { ClaudeEntry } from "./normalize";
import { cursorOf, dataOf, type ThreadData, type TurnRecord } from "./thread";
import type { ModelTotals } from "./usage";

const MAX_TURN_RECORDS = 500;

export function turnRecordOf(uuid: string, entry: ClaudeEntry): TurnRecord {
  const errors = Array.isArray(entry.errors)
    ? entry.errors.filter((e): e is string => typeof e === "string").map((e) => excerpt(e, 500))
    : undefined;
  const limit = record(entry.usage_limit);
  return {
    type: "result",
    uuid,
    ...(typeof entry.after_uuid === "string" ? { after_uuid: entry.after_uuid } : {}),
    ...(typeof entry.duration_ms === "number" ? { duration_ms: entry.duration_ms } : {}),
    ...(typeof entry.turn_cost_usd === "number" ? { turn_cost_usd: entry.turn_cost_usd } : {}),
    ...(entry.is_error === true ? { is_error: true } : {}),
    ...(errors?.length ? { errors } : {}),
    ...(entry.is_error === true && typeof entry.result === "string"
      ? { result: excerpt(entry.result, 500) }
      : {}),
    ...(limit
      ? {
          usage_limit: {
            ...(typeof limit.reason === "string" ? { reason: limit.reason } : {}),
            ...(typeof limit.resetsAt === "string" ? { resetsAt: limit.resetsAt } : {}),
          },
        }
      : {}),
    ...(entry.interrupted === true ? { interrupted: true } : {}),
  };
}

function addUsage(
  data: ThreadData,
  turnUsage: Record<string, unknown> | undefined,
): { usage: Record<string, ModelTotals>; contextMax: number | undefined } {
  const usage = { ...data.usage };
  let contextMax = data.contextMax;
  for (const [model, raw] of Object.entries(turnUsage ?? {})) {
    const fields = record(raw);
    if (!fields) continue;
    const n = (key: string) => (typeof fields[key] === "number" ? (fields[key] as number) : 0);
    const totals = usage[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
      calls: 0,
    };
    usage[model] = {
      inputTokens: totals.inputTokens + n("inputTokens"),
      outputTokens: totals.outputTokens + n("outputTokens"),
      cacheReadInputTokens: totals.cacheReadInputTokens + n("cacheReadInputTokens"),
      cacheCreationInputTokens: totals.cacheCreationInputTokens + n("cacheCreationInputTokens"),
      costUSD: totals.costUSD + n("costUSD"),
      calls: totals.calls + 1,
    };
    if (n("contextWindow") > 0) contextMax = Math.max(contextMax ?? 0, n("contextWindow"));
  }
  return { usage, contextMax };
}

export function turnPatchOf(
  row: IndexedThread,
  turn: TurnRecord,
  entry: ClaudeEntry,
  now: () => Date,
): Partial<IndexedThread> | undefined {
  const data = dataOf(row);
  const turns = data.turns ?? [];
  if (turns.some((known) => known.uuid === turn.uuid)) return undefined;
  const { usage, contextMax } = addUsage(data, record(entry.turn_model_usage));
  return {
    updatedAt: now(),
    data: {
      ...row.data,
      turns: [...turns, turn].slice(-MAX_TURN_RECORDS),
      turnCount: cursorOf(row) + 1,
      usage,
      costUsd: (data.costUsd ?? 0) + (turn.turn_cost_usd ?? 0),
      endedAt: now().getTime(),
      ...(contextMax ? { contextMax } : {}),
    } satisfies ThreadData,
  };
}
