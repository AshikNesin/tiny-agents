/**
 * Claude Code as a Code page harness. Claude Code runs on the sandbox
 * through the worker (`@tiny-agents/claude-worker`, coding mode); this
 * driver talks to it over its own Worker connection (`client.ts`).
 *
 * Claude Code keeps no thread list of its own that we use (sessions started
 * in a terminal are not discovered), so threads live in the app's thread
 * index: a row per thread with its cwd, settings and, in `data`, the Claude
 * session id plus compact turn records (duration, cost, how it ended).
 * Claude Code owns the transcript; it is read back with
 * `getSessionMessages` and merged with what streamed live.
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  CODING_EFFORT_LEVELS,
  CODING_PERMISSION_MODES,
  DEFAULT_CODING_PERMISSION_MODE,
  type CodingCatalog,
  type CodingDirectoryListing,
  type CodingEvent,
  type CodingFileMatch,
  type CodingForkResult,
  type CodingGitFile,
  type CodingGitFileDiff,
  type CodingGitLogResult,
  type CodingHistoryResult,
  type CodingResumeResult,
  type CodingSendResult,
  type CodingSessionConfig,
  type CodingSettingsChange,
  type CodingState,
  type CodingAsset,
  type CodingOp,
} from "@tiny-agents/claude-worker";
import type { ConnectionTimings } from "@tiny-agents/claude-worker/client";
import {
  NO_CAPABILITIES,
  threadIdOf,
  type Capabilities,
  type HarnessHost,
  type HarnessInstance,
  type IndexedThread,
  type InstanceEvent,
  type InstanceStatus,
  type ModelOption,
  type PermissionMode,
  type QueuedMessage,
  type RequestAnswer,
  type SlashCommand,
  type ThreadSettings,
  type ThreadSnapshot,
  type ThreadSummary,
  type TranscriptItem,
  type UsageReport,
} from "../../contracts";
import { NO_PARTIAL, ThreadFeed } from "../../server/feed";
import { Emitter, excerpt, firstLine, lastAnswer, record } from "../../server/items";
import { CodingWorkerClient, type ClientState } from "./client";
import {
  approvalRequestOf,
  normalizeEntries,
  toolSummary,
  type ApprovalRecord,
  type ClaudeEntry,
} from "./normalize";
import { usageReportOf, type ModelTotals } from "./usage";

export interface ClaudeCodeHarnessOptions {
  /** Instance id; default `claude-code`. */
  id?: string;
  host: HarnessHost;
  /** Where the worker is (the sandbox tunnel); asked again on every reconnect. */
  resolveWorker: () => Promise<{ url: string; token: string }>;
  /** An extra hint (the Claude login, the sandbox): shown when it is not `connected`. */
  status?: () => InstanceStatus;
  /** Connection timings (tests). */
  timings?: Partial<ConnectionTimings>;
}

export type ClaudeCodeHarness = HarnessInstance;

const CAPABILITIES: Capabilities = {
  ...NO_CAPABILITIES,
  turns: {
    interrupt: true,
    // The SDK folds a `priority: "next"` user message into the running turn.
    steer: true,
    queue: true,
    manageQueue: true,
    recovery: [],
    compact: true,
  },
  threads: {
    fork: true,
    archive: true,
    delete: false,
    rename: true,
    changeCwd: false,
    subagents: false,
    search: false,
    discover: false,
  },
  settings: {
    modelSwitch: true,
    effortLevels: [...CODING_EFFORT_LEVELS],
    permissionModes: [...CODING_PERMISSION_MODES],
    defaultPermissionMode: DEFAULT_CODING_PERMISSION_MODE,
  },
  approvals: { tools: true, questions: true },
  workspace: {
    diffs: true,
    findFiles: true,
    uploads: true,
    skills: false,
    browse: true,
    worktrees: false,
    requiresCwd: true,
  },
  extras: { jobs: false, usageReport: true, commands: true },
};

/** Claude Code's model aliases; replaced by `supportedModels()` once a session ran. */
const STATIC_MODELS: ModelOption[] = [
  { id: "default", label: "Default (recommended)", isDefault: true, supportsReasoning: true },
  { id: "opus", label: "Opus", supportsReasoning: true, supportsImages: true },
  { id: "sonnet", label: "Sonnet", supportsReasoning: true, supportsImages: true },
  { id: "haiku", label: "Haiku", supportsImages: true },
];

const DEFAULT_COMMANDS: SlashCommand[] = [
  { command: "/compact", hint: "Summarize the conversation to free context" },
  { command: "/init", hint: "Write a CLAUDE.md for this repository" },
  { command: "/review", hint: "Review the current changes" },
];

const MAX_TURN_RECORDS = 500;

/** A compact `result`, kept in the index so history shows the same turn rows. */
interface TurnRecord extends ClaudeEntry {
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

interface ThreadData {
  claudeSessionId?: string;
  turns?: TurnRecord[];
  turnCount?: number;
  usage?: Record<string, ModelTotals>;
  costUsd?: number;
  endedAt?: number;
  failed?: boolean;
  contextMax?: number;
}

interface Runtime {
  nativeId: string;
  row: IndexedThread;
  history: ClaudeEntry[] | undefined;
  loading: Promise<void> | undefined;
  live: ClaudeEntry[];
  liveIndex: Map<string, number>;
  requests: Map<string, ApprovalRecord>;
  notified: Set<string>;
  working: boolean;
  queued: QueuedMessage[];
  /** What this thread's watchers are sent (rows, streaming text, state). */
  feed: ThreadFeed;
  /** Events up to here are a replay (after an app restart): no pushes for them. */
  replayUntil: number;
  chain: Promise<void>;
  /** Index writes, in order. */
  writes: Promise<void>;
}

function dataOf(row: IndexedThread): ThreadData {
  return row.data as ThreadData;
}

/** Turns ended so far: grows by one per turn, which is what "unread" needs. */
function cursorOf(row: IndexedThread): number {
  const data = dataOf(row);
  return data.turnCount ?? data.turns?.length ?? 0;
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return (CODING_PERMISSION_MODES as readonly unknown[]).includes(value);
}

function isEffort(value: unknown): value is (typeof CODING_EFFORT_LEVELS)[number] {
  return (CODING_EFFORT_LEVELS as readonly unknown[]).includes(value);
}

function newNativeId(): string {
  return randomBytes(12).toString("base64url");
}

function badInput(message: string): Error {
  const error = new Error(message);
  error.name = "BadRequest";
  return error;
}

export function createClaudeCodeHarness(options: ClaudeCodeHarnessOptions): ClaudeCodeHarness {
  const instanceId = options.id ?? "claude-code";
  const { host } = options;
  const log = host.logger;
  const events = new Emitter<InstanceEvent>((error) =>
    log.warn("claude-code listener failed", { error: String(error) }),
  );
  const runtimes = new Map<string, Promise<Runtime | undefined>>();
  const loaded = new Map<string, Runtime>();
  let catalog: CodingCatalog | undefined;
  let started = false;

  const client = new CodingWorkerClient(
    options.resolveWorker,
    {
      onEvent: (sessionId, seq, event) => {
        void withRuntime(sessionId, (runtime) => applyEvent(runtime, seq, event));
      },
      onPartial: (sessionId, partial) => {
        const runtime = loaded.get(sessionId);
        if (!runtime) return;
        if (!partial.text && !partial.thinking && !partial.reset) return;
        const now = partial.reset ? NO_PARTIAL : runtime.feed.partialNow;
        runtime.feed.partial({
          text: now.text + (partial.text ?? ""),
          thinking: now.thinking + (partial.thinking ?? ""),
        });
      },
      onCatalog: (next) => {
        catalog = next;
      },
      onConnected: (hello, rebooted) => {
        if (rebooted) {
          // Events may have been lost with the old worker: start over from disk.
          for (const runtime of loaded.values()) {
            void withRuntime(runtime.nativeId, async () => {
              resetLiveState(runtime);
              await reload(runtime);
            });
          }
        }
        // Pick up turns that run in the worker but that this process has not seen.
        for (const session of hello.sessions) {
          if (session.running || session.live) void withRuntime(session.sessionId, () => undefined);
        }
        events.emit({ type: "connected" });
      },
      onResume: (sessionId, result) => {
        void withRuntime(sessionId, (runtime) => onResume(runtime, result));
      },
      onState: () => {
        events.emit({ type: "status", status: status() });
      },
      onError: (message) => log.warn("claude-code worker", { message }),
    },
    options.timings,
  );

  // --- runtimes --------------------------------------------------------------

  function ensureRuntime(nativeId: string): Promise<Runtime | undefined> {
    let pending = runtimes.get(nativeId);
    if (!pending) {
      pending = host.index.get(instanceId, nativeId).then((row) => {
        if (!row) {
          runtimes.delete(nativeId);
          return undefined;
        }
        const runtime: Runtime = {
          nativeId,
          row,
          history: undefined,
          loading: undefined,
          live: [],
          liveIndex: new Map(),
          requests: new Map(),
          notified: new Set(),
          working: false,
          queued: [],
          feed: new ThreadFeed((error) =>
            log.warn("claude-code watcher failed", { nativeId, error: String(error) }),
          ),
          replayUntil: 0,
          chain: Promise.resolve(),
          writes: Promise.resolve(),
        };
        loaded.set(nativeId, runtime);
        client.track(nativeId);
        return runtime;
      });
      runtimes.set(nativeId, pending);
    }
    return pending;
  }

  async function runtimeOf(nativeId: string): Promise<Runtime> {
    const runtime = await ensureRuntime(nativeId);
    if (!runtime) {
      const error = new Error(`No Claude Code thread ${nativeId}.`);
      error.name = "NotFound";
      throw error;
    }
    return runtime;
  }

  /** Run `fn` on the thread's runtime, one event at a time, in order. */
  function withRuntime(nativeId: string, fn: (runtime: Runtime) => unknown): Promise<void> {
    return ensureRuntime(nativeId).then((runtime) => {
      if (!runtime) return;
      runtime.chain = runtime.chain
        .then(async () => {
          await fn(runtime);
        })
        .catch((error: unknown) =>
          log.warn("claude-code event failed", { nativeId, error: String(error) }),
        );
      return runtime.chain;
    });
  }

  /**
   * Index writes for one thread run one at a time, each patch computed from
   * the row as the previous write left it, so a rename racing a turn's end
   * cannot drop the turn record. A patch function may return undefined: no write.
   */
  function saveRow(
    runtime: Runtime,
    patch: Partial<IndexedThread> | ((row: IndexedThread) => Partial<IndexedThread> | undefined),
  ): Promise<void> {
    const write = runtime.writes.then(async () => {
      const next = typeof patch === "function" ? patch(runtime.row) : patch;
      if (!next) return;
      runtime.row = await host.index.upsert({ ...next, instanceId, nativeId: runtime.nativeId });
    });
    runtime.writes = write.catch(() => undefined);
    return write;
  }

  function saveData(runtime: Runtime, patch: Partial<ThreadData>): Promise<void> {
    return saveRow(runtime, (row) => ({ data: { ...row.data, ...patch } }));
  }

  /** The worker lost the session (it restarted): nothing runs, nothing waits. */
  function resetLiveState(runtime: Runtime): void {
    const wasWorking = runtime.working;
    runtime.working = false;
    runtime.queued = [];
    for (const request of runtime.requests.values()) {
      if (request.status === "open") request.status = "expired";
    }
    emitItems(runtime);
    // Not working: the feed drops the streaming text with this state.
    emitState(runtime);
    if (wasWorking) events.emit({ type: "threads" });
  }

  async function onResume(runtime: Runtime, result: CodingResumeResult): Promise<void> {
    runtime.replayUntil = result.lastSeq;
    // Unknown: the transcript on disk is still right; only the live state goes.
    if (!result.known) resetLiveState(runtime);
    else if (result.gap) await reload(runtime);
  }

  /** Read history again (events were missed) and send every watcher a fresh snapshot. */
  async function reload(runtime: Runtime): Promise<void> {
    await runtime.loading?.catch(() => undefined);
    runtime.history = undefined;
    runtime.live = [];
    runtime.liveIndex.clear();
    if (runtime.feed.size === 0) return;
    await loadHistory(runtime);
    runtime.feed.snapshot(snapshotOf(runtime));
  }

  async function loadHistory(runtime: Runtime): Promise<void> {
    if (runtime.history) return;
    if (!runtime.loading) {
      runtime.loading = (async () => {
        const claudeSessionId = dataOf(runtime.row).claudeSessionId;
        const cwd = runtime.row.cwd;
        if (!claudeSessionId || !cwd) {
          runtime.history = [];
          return;
        }
        const result = await client.request<CodingHistoryResult>({
          type: "coding.history",
          claudeSessionId,
          cwd,
        });
        runtime.history = result.messages as ClaudeEntry[];
      })().finally(() => {
        runtime.loading = undefined;
      });
    }
    await runtime.loading;
  }

  // --- transcript -------------------------------------------------------------

  /** History, then what streamed live, with each turn's record after its last entry. */
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

  function itemsOf(runtime: Runtime): { items: TranscriptItem[]; cursor: number } {
    const entries = entriesOf(runtime);
    return {
      items: normalizeEntries(entries, { requests: [...runtime.requests.values()] }),
      cursor: cursorOf(runtime.row),
    };
  }

  function contextOf(runtime: Runtime): { used: number; max?: number } {
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

  function settingsOf(row: IndexedThread): ThreadSettings {
    return {
      model: row.model,
      effort: row.effort,
      permissionMode: isPermissionMode(row.permissionMode)
        ? row.permissionMode
        : DEFAULT_CODING_PERMISSION_MODE,
    };
  }

  function summaryOf(row: IndexedThread, runtime?: Runtime): ThreadSummary {
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

  function snapshotOf(runtime: Runtime): ThreadSnapshot {
    return {
      thread: summaryOf(runtime.row, runtime),
      items: itemsOf(runtime).items,
      settings: settingsOf(runtime.row),
      queued: runtime.queued,
      jobs: [],
      children: [],
      context: contextOf(runtime),
      costUsd: dataOf(runtime.row).costUsd ?? 0,
    };
  }

  function emitItems(runtime: Runtime): void {
    // Normalizing the transcript is the costly part: only for someone watching.
    if (!runtime.feed.live) return;
    const { items, cursor } = itemsOf(runtime);
    runtime.feed.items(items, cursor);
  }

  function emitState(runtime: Runtime): void {
    runtime.feed.state({
      working: runtime.working,
      context: contextOf(runtime),
      queued: runtime.queued,
      jobs: [],
      settings: settingsOf(runtime.row),
      costUsd: dataOf(runtime.row).costUsd ?? 0,
    });
  }

  // --- worker events ----------------------------------------------------------

  async function applyEvent(runtime: Runtime, seq: number, event: CodingEvent): Promise<void> {
    switch (event.type) {
      case "message": {
        const entry = event.message as ClaudeEntry;
        if (entry.type === "result") {
          await onResult(runtime, entry);
          break;
        }
        const at = entry.uuid ? runtime.liveIndex.get(entry.uuid) : undefined;
        if (at !== undefined) runtime.live[at] = entry;
        else {
          if (entry.uuid) runtime.liveIndex.set(entry.uuid, runtime.live.length);
          runtime.live.push(entry);
        }
        emitItems(runtime);
        if (entry.type === "assistant") {
          // The finished message replaces the streaming text.
          runtime.feed.partial(NO_PARTIAL);
          emitState(runtime);
        }
        break;
      }
      case "state":
        await onState(runtime, event.state);
        break;
      case "request": {
        const { approval } = event;
        runtime.requests.set(approval.approvalId, {
          approvalId: approval.approvalId,
          ...(approval.toolUseId ? { toolUseId: approval.toolUseId } : {}),
          toolName: approval.toolName,
          input: approval.input,
          ...(approval.reason ? { reason: approval.reason } : {}),
          ...(approval.title ? { title: approval.title } : {}),
          status: "open",
        });
        emitItems(runtime);
        break;
      }
      case "request_closed": {
        const request = runtime.requests.get(event.approvalId);
        if (request) request.status = event.status;
        emitItems(runtime);
        break;
      }
    }
    if (seq >= runtime.replayUntil) notifyOpenRequests(runtime);
  }

  /** Ask for the owner once per open approval (after a replay: only those still open). */
  function notifyOpenRequests(runtime: Runtime): void {
    for (const request of runtime.requests.values()) {
      if (request.status !== "open" || runtime.notified.has(request.approvalId)) continue;
      runtime.notified.add(request.approvalId);
      const asked = approvalRequestOf(request);
      const text =
        asked.kind === "question"
          ? `Claude Code asks: ${asked.questions[0]?.question ?? "a question"}`
          : `Claude Code wants to use ${request.toolName}: ${toolSummary(request.toolName, request.input)}`;
      events.emit({
        type: "attention",
        nativeId: runtime.nativeId,
        text: firstLine(text, 200),
        key: request.approvalId,
      });
    }
  }

  async function onState(runtime: Runtime, state: CodingState): Promise<void> {
    const wasWorking = runtime.working;
    runtime.working = state.running;
    runtime.queued = state.queued.map((item) => ({ ...item }));
    const data = dataOf(runtime.row);
    if (state.claudeSessionId && state.claudeSessionId !== data.claudeSessionId) {
      await saveData(runtime, { claudeSessionId: state.claudeSessionId });
    }
    const mode = state.settings.permissionMode;
    if (isPermissionMode(mode) && mode !== runtime.row.permissionMode) {
      // Claude Code changed it itself (ExitPlanMode).
      await saveRow(runtime, { permissionMode: mode });
    }
    emitState(runtime);
    if (wasWorking !== runtime.working) events.emit({ type: "threads" });
  }

  async function onResult(runtime: Runtime, entry: ClaudeEntry): Promise<void> {
    const uuid = typeof entry.uuid === "string" ? entry.uuid : randomUUID();
    const turn = turnRecordOf(uuid, entry);
    const limit = !!turn.usage_limit;
    const failed = entry.is_error === true && entry.interrupted !== true;
    let fresh = false;
    await saveRow(runtime, (row) => {
      const data = dataOf(row);
      const turns = data.turns ?? [];
      // A replay (resume after a restart) of a turn already recorded.
      if (turns.some((known) => known.uuid === uuid)) return undefined;
      fresh = true;
      const { usage, contextMax } = addUsage(data, record(entry.turn_model_usage));
      return {
        updatedAt: host.now(),
        data: {
          ...row.data,
          turns: [...turns, turn].slice(-MAX_TURN_RECORDS),
          turnCount: cursorOf(row) + 1,
          usage,
          costUsd: (data.costUsd ?? 0) + (turn.turn_cost_usd ?? 0),
          endedAt: host.now().getTime(),
          failed: failed || limit,
          ...(contextMax ? { contextMax } : {}),
        } satisfies ThreadData,
      };
    });
    if (!fresh) return;
    emitItems(runtime);
    emitState(runtime);
    const { items } = itemsOf(runtime);
    const answer = lastAnswer(items);
    const finalText =
      typeof entry.result === "string" && entry.result.trim() && !failed
        ? entry.result
        : answer.text;
    events.emit({
      type: "turn_ended",
      nativeId: runtime.nativeId,
      ...(finalText ? { finalText: excerpt(finalText) } : {}),
      ...(failed || limit ? { failed: true } : {}),
    });
  }

  function turnRecordOf(uuid: string, entry: ClaudeEntry): TurnRecord {
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

  /** Add one turn's per-model usage (from the worker's deltas) to the totals. */
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

  // --- helpers ----------------------------------------------------------------

  function sessionConfig(row: IndexedThread): CodingSessionConfig {
    if (!row.cwd) throw badInput("This Claude Code thread has no working directory.");
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

  function op<T>(body: CodingOp): Promise<T> {
    return client.request<T>({ type: "coding.op", op: body });
  }

  function status(): InstanceStatus {
    const hint = options.status?.();
    if (hint && hint.state !== "connected") return hint;
    const state: ClientState = client.state;
    if (state === "idle") return { state: "disabled", detail: "Claude Code is not started." };
    if (state === "connected")
      return { state: "connected", ...(hint?.detail ? { detail: hint.detail } : {}) };
    return { state, ...(client.detail ? { detail: client.detail } : {}) };
  }

  // --- the instance -----------------------------------------------------------

  const instance: ClaudeCodeHarness = {
    id: instanceId,
    kind: "claude-code",
    label: "Claude Code",

    capabilities: () => CAPABILITIES,

    start() {
      if (started) return;
      started = true;
      client.start();
    },

    stop() {
      started = false;
      client.stop();
    },

    status,

    subscribe: (listener) => events.add(listener),

    async listThreads(view) {
      const rows = await host.index.list(instanceId);
      return rows
        .filter((row) => row.archived === (view === "archived"))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((row) => summaryOf(row, loaded.get(row.nativeId)));
    },

    async getThread(nativeId) {
      const runtime = await runtimeOf(nativeId);
      await loadHistory(runtime);
      return snapshotOf(runtime);
    },

    watchThread(nativeId, listener) {
      let stopped = false;
      let unsubscribe: (() => void) | undefined;
      void (async () => {
        const runtime = await runtimeOf(nativeId);
        if (stopped) return;
        unsubscribe = runtime.feed.subscribe(listener);
        try {
          await loadHistory(runtime);
        } catch (error) {
          runtime.feed.error(
            `Could not read the transcript: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (stopped) return;
        // Run after any event already queued for this thread.
        await runtime.chain;
        if (!stopped && runtime.feed.waiting) runtime.feed.snapshot(snapshotOf(runtime), "waiting");
      })().catch((error: unknown) => {
        // No such thread: there is no feed to carry the error.
        try {
          listener({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        } catch (failure) {
          log.warn("claude-code watcher failed", { nativeId, error: String(failure) });
        }
      });
      return () => {
        stopped = true;
        unsubscribe?.();
      };
    },

    async outcome(nativeId) {
      const runtime = await runtimeOf(nativeId);
      await loadHistory(runtime).catch(() => undefined);
      const { items, cursor } = itemsOf(runtime);
      const answer = lastAnswer(items);
      const data = dataOf(runtime.row);
      return {
        working: runtime.working,
        title: runtime.row.title,
        cwd: runtime.row.cwd,
        text: answer.text,
        failed: data.failed ?? answer.failed,
        ...(data.endedAt ? { endedAt: data.endedAt } : {}),
        cursor,
      };
    },

    async createThread(input) {
      const cwd = input.cwd?.trim();
      if (!cwd) throw badInput("Claude Code needs a working directory.");
      const check = await op<{ valid: boolean; error?: string }>({ op: "validate_cwd", path: cwd });
      if (!check.valid) throw badInput(check.error ?? "That working directory is not usable.");
      if (input.effort && !isEffort(input.effort))
        throw badInput(`Unknown effort ${input.effort}.`);
      const nativeId = newNativeId();
      const now = host.now();
      await host.index.upsert({
        instanceId,
        nativeId,
        title: firstLine(input.message.trim(), 100) || "New thread",
        cwd,
        parentNativeId: null,
        model: input.model?.trim() || null,
        effort: input.effort ?? null,
        permissionMode: input.permissionMode ?? DEFAULT_CODING_PERMISSION_MODE,
        archived: false,
        createdAt: now,
        updatedAt: now,
        data: {},
      });
      try {
        await instance.send(nativeId, {
          message: input.message,
          ...(input.attachments ? { attachments: input.attachments } : {}),
        });
      } catch (error) {
        await host.index.remove(instanceId, nativeId);
        runtimes.delete(nativeId);
        loaded.delete(nativeId);
        throw error;
      }
      events.emit({ type: "threads" });
      return { nativeId };
    },

    async archive(nativeId, archived) {
      const runtime = await runtimeOf(nativeId);
      await saveRow(runtime, { archived });
      if (archived) {
        await client
          .request({ type: "coding.close", sessionId: nativeId })
          .catch((error: unknown) =>
            log.warn("claude-code close failed", { nativeId, error: String(error) }),
          );
      }
      events.emit({ type: "threads" });
      return { moved: [nativeId] };
    },

    async rename(nativeId, title) {
      const runtime = await runtimeOf(nativeId);
      const clean = title.trim();
      if (!clean) throw badInput("A title cannot be empty.");
      await saveRow(runtime, { title: clean.slice(0, 200) });
      runtime.feed.thread(summaryOf(runtime.row, runtime));
      events.emit({ type: "threads" });
    },

    async fork(nativeId, at) {
      const runtime = await runtimeOf(nativeId);
      const { row } = runtime;
      const claudeSessionId = dataOf(row).claudeSessionId;
      if (!claudeSessionId || !row.cwd) throw badInput("There is nothing to fork yet.");
      const title = `${row.title || "Claude Code"} (fork)`;
      const forked = await client.request<CodingForkResult>({
        type: "coding.fork",
        claudeSessionId,
        cwd: row.cwd,
        ...(at ? { upToMessageId: at } : {}),
        title,
      });
      const forkId = newNativeId();
      const now = host.now();
      // The fork remaps message uuids, so turn records do not carry over.
      await host.index.upsert({
        instanceId,
        nativeId: forkId,
        title,
        cwd: row.cwd,
        parentNativeId: nativeId,
        model: row.model,
        effort: row.effort,
        permissionMode: row.permissionMode,
        archived: false,
        createdAt: now,
        updatedAt: now,
        data: { claudeSessionId: forked.sessionId } satisfies ThreadData,
      });
      events.emit({ type: "threads" });
      return { nativeId: forkId };
    },

    async send(nativeId, input) {
      const runtime = await runtimeOf(nativeId);
      const attachments = (input.attachments ?? []).map((ref) => {
        if (!ref.startsWith("/")) throw badInput("Unknown attachment.");
        const name = ref.slice(ref.lastIndexOf("/") + 1);
        // What the model takes as image input (narrower than what the page shows inline).
        return { path: ref, name, image: /\.(png|jpe?g|gif|webp)$/i.test(name) };
      });
      const result = await client.request<CodingSendResult>({
        type: "coding.send",
        sessionId: nativeId,
        session: sessionConfig(runtime.row),
        uuid: randomUUID(),
        text: input.message,
        mode: input.queue ? "queue" : "steer",
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      await saveRow(runtime, { updatedAt: host.now() });
      return { status: result.status };
    },

    async interrupt(nativeId) {
      await runtimeOf(nativeId);
      await client.request({ type: "coding.interrupt", sessionId: nativeId });
    },

    async respond(nativeId, requestId, answer: RequestAnswer) {
      await runtimeOf(nativeId);
      await client.request({
        type: "coding.respond",
        sessionId: nativeId,
        approvalId: requestId,
        answer,
      });
    },

    async queued(nativeId, action, queuedId) {
      await runtimeOf(nativeId);
      await client.request({ type: "coding.queue", sessionId: nativeId, action, queuedId });
    },

    async updateSettings(nativeId, change) {
      const runtime = await runtimeOf(nativeId);
      const workerChange: CodingSettingsChange = {};
      const patch: Partial<IndexedThread> = {};
      if (change.model !== undefined) {
        const model = change.model?.trim() || null;
        patch.model = model;
        workerChange.model = model;
      }
      if (change.effort !== undefined) {
        if (change.effort !== null && !isEffort(change.effort)) {
          throw badInput(`Unknown effort ${change.effort}.`);
        }
        patch.effort = change.effort;
        workerChange.effort = change.effort;
      }
      if (change.permissionMode !== undefined) {
        if (change.permissionMode !== null && !isPermissionMode(change.permissionMode)) {
          throw badInput(`Unknown permission mode ${String(change.permissionMode)}.`);
        }
        patch.permissionMode = change.permissionMode;
        workerChange.permissionMode = change.permissionMode;
      }
      await saveRow(runtime, patch);
      await client.request({
        type: "coding.settings",
        sessionId: nativeId,
        session: sessionConfig(runtime.row),
        change: workerChange,
      });
      emitState(runtime);
      return settingsOf(runtime.row);
    },

    async usage(nativeId): Promise<UsageReport> {
      const runtime = await runtimeOf(nativeId);
      return usageReportOf(dataOf(runtime.row).usage ?? {});
    },

    async models() {
      const models = catalog?.models ?? [];
      if (models.length === 0) return STATIC_MODELS;
      return models.map((model) => ({
        id: model.value,
        label: model.displayName || model.value,
        ...(model.value === "default" ? { isDefault: true } : {}),
        ...(model.supportedEffortLevels?.length ? { supportsReasoning: true } : {}),
      }));
    },

    commands() {
      const commands = catalog?.commands ?? [];
      if (commands.length === 0) return DEFAULT_COMMANDS;
      return commands.map((command) => ({
        command: `/${command.name}`,
        hint: command.description || command.argumentHint || "",
      }));
    },

    findFiles(dir, query, content) {
      return op<CodingFileMatch[]>({
        op: "find_files",
        dir,
        query,
        ...(content ? { content } : {}),
      });
    },

    async upload(file, filename) {
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");
      const result = await op<{ ref: string }>({ op: "upload", filename, data });
      return { ref: result.ref };
    },

    async asset(ref) {
      const asset = await op<CodingAsset>({ op: "read_asset", ref });
      return new Response(Buffer.from(asset.data, "base64"), {
        headers: {
          "content-type": asset.mimeType,
          "content-disposition": `inline; filename="${asset.name.replace(/["\\\r\n]/g, "_")}"`,
          "cache-control": "private, max-age=3600",
        },
      });
    },

    browse(path) {
      return op<CodingDirectoryListing>({ op: "list_dir", ...(path ? { path } : {}) });
    },

    validateCwd(path) {
      return op<{ valid: boolean; error?: string }>({ op: "validate_cwd", path });
    },

    async diffs(cwd) {
      const result = await op<CodingGitLogResult>({ op: "git_log", cwd });
      return { diffs: result.diffs, gitRoot: result.gitRoot };
    },

    diffFiles(cwd, diffId) {
      return op<CodingGitFile[]>({ op: "git_files", cwd, diffId });
    },

    fileDiff(cwd, diffId, path) {
      return op<CodingGitFileDiff>({ op: "git_file", cwd, diffId, path });
    },
  };
  return instance;
}
