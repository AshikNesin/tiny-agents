import { randomUUID } from "node:crypto";
import {
  DEFAULT_CODING_PERMISSION_MODE,
  type CodingCatalog,
  type CodingEvent,
  type CodingForkResult,
  type CodingHistoryResult,
  type CodingResumeResult,
  type CodingSendResult,
  type CodingState,
  type CodingSkill,
  type CodingOp,
} from "@tiny-agents/claude-worker";
import type { ConnectionTimings } from "@tiny-agents/claude-worker/client";
import type {
  HarnessHost,
  HarnessInstance,
  IndexedThread,
  InstanceEvent,
  InstanceStatus,
  ModelOption,
  RequestAnswer,
  ToolChoice,
  UsageReport,
} from "../../contracts";
import { badRequest, notFound } from "../../server/errors";
import { NO_PARTIAL, ThreadFeed } from "../../server/feed";
import { Emitter, firstLine } from "../../server/items";
import { CAPABILITIES, commandsOf, modelOptionsOf } from "./catalog";
import { CodingWorkerClient, type ClientState } from "./client";
import { callFailed, sessionWithTools, type AppToolPort } from "./app-tools";
import type { ClaudeEntry } from "./normalize";
import {
  dataOf,
  isEffort,
  isPermissionMode,
  newNativeId,
  outcomeOf,
  settingsOf,
  snapshotOf,
  summaryOf,
  unknownEffort,
  contextOf,
  itemsOf,
  approvalRecordOf,
  settingsChangeOf,
  attentionTextOf,
  type AppToolCall,
  type Runtime,
  type ThreadData,
} from "./thread";
import { turnPatchOf, turnRecordOf } from "./turns";
import { usageReportOf } from "./usage";
import { workspaceOps } from "./workspace";

export interface ClaudeCodeHarnessOptions {
  id?: string;
  host: HarnessHost;
  tools?: AppToolPort;
  toolChoices?: () => Promise<ToolChoice[]>;
  skills?: () => Promise<CodingSkill[]>;
  resolveWorker: () => Promise<{ url: string; token: string }>;
  status?: () => InstanceStatus;
  timings?: Partial<ConnectionTimings>;
  models?: () => ModelOption[];
  liveLimit?: number;
}

export type ClaudeCodeHarness = HarnessInstance;

const LIVE_LIMIT = 2_000;

export function createClaudeCodeHarness(options: ClaudeCodeHarnessOptions): ClaudeCodeHarness {
  const instanceId = options.id ?? "claude-code";
  const { host } = options;
  const log = host.logger;
  const events = new Emitter<InstanceEvent>((error) =>
    log.warn("claude-code listener failed", { error: String(error) }),
  );
  const runtimes = new Map<string, Promise<Runtime | undefined>>();
  const loaded = new Map<string, Runtime>();
  const liveLimit = options.liveLimit ?? LIVE_LIMIT;
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
          for (const runtime of loaded.values()) {
            void withRuntime(runtime.nativeId, async () => {
              resetLiveState(runtime);
              await reload(runtime);
            });
          }
        }
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
          calls: new Map(),
          calling: new Set(),
          working: false,
          ending: false,
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
    if (!runtime) throw notFound(`No Claude Code thread ${nativeId}.`);
    return runtime;
  }

  function forgetRuntime(nativeId: string): void {
    runtimes.delete(nativeId);
    const runtime = loaded.get(nativeId);
    if (!runtime) return;
    loaded.delete(nativeId);
    client.untrack(nativeId);
  }

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

  function saveRow(
    runtime: Runtime,
    patch: Partial<IndexedThread> | ((row: IndexedThread) => Partial<IndexedThread> | undefined),
  ): Promise<void> {
    const write = runtime.writes.then(async () => {
      const next = typeof patch === "function" ? patch(runtime.row) : patch;
      if (!next) return;
      runtime.row = await host.index.upsert({ ...next, instanceId, nativeId: runtime.nativeId });
    });
    runtime.writes = Promise.allSettled([write]).then(() => undefined);
    return write;
  }

  function saveData(runtime: Runtime, patch: Partial<ThreadData>): Promise<void> {
    return saveRow(runtime, (row) => ({ data: { ...row.data, ...patch } }));
  }

  function resetLiveState(runtime: Runtime): void {
    const wasWorking = runtime.working;
    runtime.working = false;
    runtime.queued = [];
    for (const request of runtime.requests.values()) {
      if (request.status === "open") request.status = "expired";
    }
    emitItems(runtime);
    emitState(runtime);
    if (wasWorking) events.emit({ type: "threads" });
    reportTurnEnd(runtime);
  }

  async function onResume(runtime: Runtime, result: CodingResumeResult): Promise<void> {
    runtime.replayUntil = result.lastSeq;
    if (!result.known) resetLiveState(runtime);
    else if (result.gap) await reload(runtime);
  }

  async function reload(runtime: Runtime): Promise<void> {
    await Promise.allSettled([runtime.loading]);
    runtime.history = undefined;
    runtime.live = [];
    runtime.liveIndex.clear();
    if (runtime.feed.size === 0) return;
    await loadHistory(runtime);
    runtime.feed.snapshot(snapshotOf(instanceId, runtime));
  }

  async function trimLive(runtime: Runtime): Promise<void> {
    if (runtime.live.length <= liveLimit) return;
    runtime.history = undefined;
    runtime.live = [];
    runtime.liveIndex.clear();
    if (runtime.feed.size === 0) return;
    await loadHistory(runtime);
    runtime.feed.snapshot(snapshotOf(instanceId, runtime));
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

  function emitItems(runtime: Runtime): void {
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
        await trimLive(runtime);
        emitItems(runtime);
        if (entry.type === "assistant") {
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
        runtime.requests.set(approval.approvalId, approvalRecordOf(approval));
        emitItems(runtime);
        break;
      }
      case "request_closed": {
        const request = runtime.requests.get(event.approvalId);
        if (request) request.status = event.status;
        emitItems(runtime);
        break;
      }
      case "tool_call":
        runtime.calls.set(event.callId, {
          server: event.server,
          tool: event.tool,
          input: event.input,
        });
        break;
      case "tool_call_closed":
        runtime.calls.delete(event.callId);
        break;
    }
    if (seq >= runtime.replayUntil) {
      notifyOpenRequests(runtime);
      runOpenCalls(runtime);
    }
  }

  function runOpenCalls(runtime: Runtime): void {
    for (const [callId, call] of runtime.calls) {
      if (runtime.calling.has(callId)) continue;
      runtime.calling.add(callId);
      void answerCall(runtime.nativeId, callId, call).finally(() => runtime.calling.delete(callId));
    }
  }

  async function answerCall(nativeId: string, callId: string, call: AppToolCall): Promise<void> {
    const outcome = options.tools
      ? await options.tools.call(call.server, call.tool, call.input).catch(callFailed)
      : { content: "This app offers no tools to Claude Code.", isError: true };
    await client
      .request({ type: "coding.tool_result", sessionId: nativeId, callId, ...outcome })
      .catch((error: unknown) =>
        log.warn("claude-code tool result not delivered", { callId, error: String(error) }),
      );
  }

  function notifyOpenRequests(runtime: Runtime): void {
    for (const request of runtime.requests.values()) {
      if (request.status !== "open" || runtime.notified.has(request.approvalId)) continue;
      runtime.notified.add(request.approvalId);
      events.emit({
        type: "attention",
        nativeId: runtime.nativeId,
        text: firstLine(attentionTextOf(request), 200),
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
      await saveRow(runtime, { permissionMode: mode });
    }
    emitState(runtime);
    if (wasWorking !== runtime.working) events.emit({ type: "threads" });
    reportTurnEnd(runtime);
  }

  function reportTurnEnd(runtime: Runtime): void {
    if (!runtime.ending || runtime.working) return;
    runtime.ending = false;
    events.emit({
      type: "turn_ended",
      nativeId: runtime.nativeId,
      outcome: outcomeOf(instanceId, runtime),
    });
  }

  async function onResult(runtime: Runtime, entry: ClaudeEntry): Promise<void> {
    const uuid = typeof entry.uuid === "string" ? entry.uuid : randomUUID();
    const turn = turnRecordOf(uuid, entry);
    let fresh = false;
    await saveRow(runtime, (row) => {
      const patch = turnPatchOf(row, turn, entry, () => host.now());
      if (patch) fresh = true;
      return patch;
    });
    if (!fresh) return;
    runtime.ending = true;
    emitItems(runtime);
    emitState(runtime);
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
        .map((row) => summaryOf(instanceId, row, loaded.get(row.nativeId)));
    },

    async getThread(nativeId) {
      const runtime = await runtimeOf(nativeId);
      await loadHistory(runtime);
      return snapshotOf(instanceId, runtime);
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
        await runtime.chain;
        if (!stopped && runtime.feed.waiting)
          runtime.feed.snapshot(snapshotOf(instanceId, runtime), "waiting");
      })().catch((error: unknown) => {
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
      await loadHistory(runtime).catch((error: unknown) =>
        log.warn("Could not load a Claude Code thread's history for its outcome", {
          nativeId,
          error: String(error),
        }),
      );
      return outcomeOf(instanceId, runtime);
    },

    async createThread(input) {
      const cwd = input.cwd?.trim();
      if (!cwd) throw badRequest("Claude Code needs a working directory.");
      const check = await op<{ valid: boolean; error?: string }>({ op: "validate_cwd", path: cwd });
      if (!check.valid) throw badRequest(check.error ?? "That working directory is not usable.");
      if (input.effort && !isEffort(input.effort)) throw unknownEffort(input.effort);
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
        if (runtime.feed.size === 0 && !runtime.working) forgetRuntime(nativeId);
      }
      events.emit({ type: "threads" });
      return { moved: [nativeId] };
    },

    async rename(nativeId, title) {
      const runtime = await runtimeOf(nativeId);
      const clean = title.trim();
      if (!clean) throw badRequest("A title cannot be empty.");
      await saveRow(runtime, { title: clean.slice(0, 200) });
      runtime.feed.thread(summaryOf(instanceId, runtime.row, runtime));
      events.emit({ type: "threads" });
    },

    async fork(nativeId, at) {
      const runtime = await runtimeOf(nativeId);
      const { row } = runtime;
      const claudeSessionId = dataOf(row).claudeSessionId;
      if (!claudeSessionId || !row.cwd) throw badRequest("There is nothing to fork yet.");
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
        if (!ref.startsWith("/")) throw badRequest("Unknown attachment.");
        const name = ref.slice(ref.lastIndexOf("/") + 1);
        return { path: ref, name, image: /\.(png|jpe?g|gif|webp)$/i.test(name) };
      });
      const result = await client.request<CodingSendResult>({
        type: "coding.send",
        sessionId: nativeId,
        session: await sessionWithTools(runtime.row, options),
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
      const { patch, workerChange } = settingsChangeOf(change);
      await saveRow(runtime, patch);
      await client.request({
        type: "coding.settings",
        sessionId: nativeId,
        session: await sessionWithTools(runtime.row, options),
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
      const plan = options.models?.() ?? [];
      if (plan.length > 0) return plan;
      return modelOptionsOf(catalog);
    },

    ...(options.toolChoices ? { tools: options.toolChoices } : {}),

    ...workspaceOps(op),

    commands() {
      return commandsOf(catalog);
    },
  };
  return instance;
}
