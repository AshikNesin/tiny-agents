import { randomBytes } from "node:crypto";
import {
  CODING_EFFORT_LEVELS,
  CODING_PERMISSION_MODES,
  DEFAULT_CODING_PERMISSION_MODE,
  type CodingEvent,
  type CodingSessionConfig,
  type CodingSettingsChange,
} from "@tiny-agents/claude-worker";
import {
  threadIdOf,
  type IndexedThread,
  type PermissionMode,
  type QueuedMessage,
  type ThreadSettings,
  type ThreadSnapshot,
  type ThreadSummary,
  type TranscriptItem,
  type TurnOutcome,
} from "../../contracts";
import { badRequest } from "../../server/errors";
import type { ThreadFeed } from "../../server/feed";
import { record } from "../../server/items";
import { turnOutcome } from "../../server/outcome";
import {
  approvalRequestOf,
  normalizeEntries,
  toolSummary,
  type ApprovalRecord,
  type ClaudeEntry,
} from "./normalize";
import type { ModelTotals } from "./usage";

export interface AppToolCall {
  server: string;
  tool: string;
  input: Record<string, unknown>;
}

export interface TurnRecord extends ClaudeEntry {
  type: "result";
  uuid: string;
  after_uuid?: string;
  duration_ms?: number;
  turn_cost_usd?: number;
  is_error?: boolean;
  errors?: string[];
  result?: string;
  usage_limit?: { reason?: string; resetsAt?: string };
  interrupted?: boolean;
}

export interface ThreadData {
  claudeSessionId?: string;
  turns?: TurnRecord[];
  turnCount?: number;
  usage?: Record<string, ModelTotals>;
  costUsd?: number;
  endedAt?: number;
  contextMax?: number;
}

export interface Runtime {
  nativeId: string;
  row: IndexedThread;
  history: ClaudeEntry[] | undefined;
  loading: Promise<void> | undefined;
  live: ClaudeEntry[];
  liveIndex: Map<string, number>;
  requests: Map<string, ApprovalRecord>;
  notified: Set<string>;
  calls: Map<string, AppToolCall>;
  calling: Set<string>;
  working: boolean;
  ending: boolean;
  queued: QueuedMessage[];
  feed: ThreadFeed;
  replayUntil: number;
  chain: Promise<void>;
  writes: Promise<void>;
}

export function dataOf(row: IndexedThread): ThreadData {
  return row.data as ThreadData;
}

export function cursorOf(row: IndexedThread): number {
  const data = dataOf(row);
  return data.turnCount ?? data.turns?.length ?? 0;
}

export function isPermissionMode(value: unknown): value is PermissionMode {
  return (CODING_PERMISSION_MODES as readonly unknown[]).includes(value);
}

export function isEffort(value: unknown): value is (typeof CODING_EFFORT_LEVELS)[number] {
  return (CODING_EFFORT_LEVELS as readonly unknown[]).includes(value);
}

export function newNativeId(): string {
  return randomBytes(12).toString("base64url");
}

export function unknownEffort(effort: string) {
  return badRequest(`Unknown effort "${effort}". Use one of: ${CODING_EFFORT_LEVELS.join(", ")}.`);
}

function entriesOf(runtime: Runtime): ClaudeEntry[] {
  const base: ClaudeEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...(runtime.history ?? []), ...runtime.live]) {
    if (entry.uuid) {
      if (seen.has(entry.uuid)) continue;
      seen.add(entry.uuid);
    }
    base.push(entry);
  }
  const after = new Map<string, TurnRecord[]>();
  for (const turn of dataOf(runtime.row).turns ?? []) {
    if (!turn.after_uuid || !seen.has(turn.after_uuid)) continue;
    const list = after.get(turn.after_uuid) ?? [];
    list.push(turn);
    after.set(turn.after_uuid, list);
  }
  const out: ClaudeEntry[] = [];
  for (const entry of base) {
    out.push(entry);
    if (entry.uuid) out.push(...(after.get(entry.uuid) ?? []));
  }
  return out;
}

export function itemsOf(runtime: Runtime): { items: TranscriptItem[]; cursor: number } {
  const entries = entriesOf(runtime);
  return {
    items: normalizeEntries(entries, { requests: [...runtime.requests.values()] }),
    cursor: cursorOf(runtime.row),
  };
}

export function contextOf(runtime: Runtime): { used: number; max?: number } {
  const max = dataOf(runtime.row).contextMax;
  const entries = [...(runtime.history ?? []), ...runtime.live];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type !== "assistant" || entry.parent_tool_use_id) continue;
    const usage = record(record(entry.message)?.usage);
    if (!usage) continue;
    const n = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0);
    const used =
      n("input_tokens") +
      n("cache_creation_input_tokens") +
      n("cache_read_input_tokens") +
      n("output_tokens");
    if (used > 0) return { used, ...(max ? { max } : {}) };
  }
  return { used: 0, ...(max ? { max } : {}) };
}

export function settingsOf(row: IndexedThread): ThreadSettings {
  return {
    model: row.model,
    effort: row.effort,
    permissionMode: isPermissionMode(row.permissionMode)
      ? row.permissionMode
      : DEFAULT_CODING_PERMISSION_MODE,
  };
}

export function summaryOf(
  instanceId: string,
  row: IndexedThread,
  runtime?: Runtime,
): ThreadSummary {
  const parentId = row.parentNativeId ? threadIdOf(instanceId, row.parentNativeId) : null;
  return {
    id: threadIdOf(instanceId, row.nativeId),
    instanceId,
    kind: "claude-code",
    nativeId: row.nativeId,
    title: row.title || "Claude Code",
    cwd: row.cwd,
    model: row.model,
    parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    working: runtime?.working ?? false,
    archived: row.archived,
    cursor: cursorOf(row),
    permissionMode: settingsOf(row).permissionMode,
    ...(runtime && runtime.queued.length > 0 ? { queuedCount: runtime.queued.length } : {}),
  };
}

export function snapshotOf(instanceId: string, runtime: Runtime): ThreadSnapshot {
  return {
    thread: summaryOf(instanceId, runtime.row, runtime),
    items: itemsOf(runtime).items,
    settings: settingsOf(runtime.row),
    queued: runtime.queued,
    jobs: [],
    children: [],
    context: contextOf(runtime),
    costUsd: dataOf(runtime.row).costUsd ?? 0,
  };
}

export function outcomeOf(instanceId: string, runtime: Runtime): TurnOutcome {
  return turnOutcome({
    thread: summaryOf(instanceId, runtime.row, runtime),
    items: itemsOf(runtime).items,
    endedAt: dataOf(runtime.row).endedAt,
  });
}

export function sessionConfig(row: IndexedThread): CodingSessionConfig {
  if (!row.cwd) throw badRequest("This Claude Code thread has no working directory.");
  const data = dataOf(row);
  return {
    cwd: row.cwd,
    ...(data.claudeSessionId ? { resume: data.claudeSessionId } : {}),
    model: row.model,
    effort: isEffort(row.effort) ? row.effort : null,
    permissionMode: isPermissionMode(row.permissionMode)
      ? row.permissionMode
      : DEFAULT_CODING_PERMISSION_MODE,
  };
}

export function approvalRecordOf(
  approval: Extract<CodingEvent, { type: "request" }>["approval"],
): ApprovalRecord {
  return {
    approvalId: approval.approvalId,
    ...(approval.toolUseId ? { toolUseId: approval.toolUseId } : {}),
    toolName: approval.toolName,
    input: approval.input,
    ...(approval.reason ? { reason: approval.reason } : {}),
    ...(approval.title ? { title: approval.title } : {}),
    status: "open",
  };
}

export function settingsChangeOf(change: Partial<ThreadSettings>): {
  patch: Partial<IndexedThread>;
  workerChange: CodingSettingsChange;
} {
  const workerChange: CodingSettingsChange = {};
  const patch: Partial<IndexedThread> = {};
  if (change.model !== undefined) {
    const model = change.model?.trim() || null;
    patch.model = model;
    workerChange.model = model;
  }
  if (change.effort !== undefined) {
    if (change.effort !== null && !isEffort(change.effort)) {
      throw unknownEffort(change.effort);
    }
    patch.effort = change.effort;
    workerChange.effort = change.effort;
  }
  if (change.permissionMode !== undefined) {
    if (change.permissionMode !== null && !isPermissionMode(change.permissionMode)) {
      throw badRequest(
        `Unknown permission mode "${String(change.permissionMode)}". Use one of: ${CODING_PERMISSION_MODES.join(", ")}.`,
      );
    }
    patch.permissionMode = change.permissionMode;
    workerChange.permissionMode = change.permissionMode;
  }
  return { patch, workerChange };
}

export function attentionTextOf(request: ApprovalRecord): string {
  const asked = approvalRequestOf(request);
  return asked.kind === "question"
    ? `Claude Code asks: ${asked.questions[0]?.question ?? "a question"}`
    : `Claude Code wants to use ${request.toolName}: ${toolSummary(request.toolName, request.input)}`;
}
