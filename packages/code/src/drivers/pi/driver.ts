import { randomUUID } from "node:crypto";
import {
  NO_CAPABILITIES,
  threadIdOf,
  type Capabilities,
  type HarnessHost,
  type HarnessInstance,
  type IndexedThread,
  type InstanceEvent,
  type ModelOption,
  type PermissionMode,
  type RequestAnswer,
  type SlashCommand,
  type ThreadSettings,
  type ThreadSnapshot,
  type ThreadSummary,
  type TurnOutcome,
} from "../../contracts";
import { HarnessError, badRequest, capabilityMissing, notFound } from "../../server/errors";
import { ThreadFeed } from "../../server/feed";
import { Emitter, firstLine } from "../../server/items";
import { turnOutcome } from "../../server/outcome";
import { normalizeChat, queuedOf, requestIdOf, type PiTranscript } from "./normalize";
import {
  applyChatEvents,
  type PiAnswer,
  type PiChatEvent,
  type PiChatState,
  type PiPort,
  type PiThreadConfig,
  type PiToolCall,
} from "./port";

export interface PiHarnessOptions {
  id?: string;
  host: HarnessHost;
  port: PiPort;
}

const PERMISSION_MODES: PermissionMode[] = ["default", "acceptEdits", "plan", "bypassPermissions"];
const DEFAULT_PERMISSION_MODE: PermissionMode = "bypassPermissions";
const STOPPED_KEPT = 200;

const CAPABILITIES: Capabilities = {
  ...NO_CAPABILITIES,
  turns: {
    interrupt: true,
    steer: true,
    queue: true,
    manageQueue: true,
    recovery: ["continue"],
    compact: true,
  },
  threads: {
    ...NO_CAPABILITIES.threads,
    fork: true,
    rewind: true,
    archive: true,
    rename: true,
  },
  settings: {
    modelSwitch: true,
    effortLevels: [],
    permissionModes: PERMISSION_MODES,
    defaultPermissionMode: DEFAULT_PERMISSION_MODE,
  },
  approvals: { tools: true, questions: true },
  workspace: { ...NO_CAPABILITIES.workspace, skills: true, requiresCwd: true },
  extras: { jobs: false, usageReport: false, commands: true },
};

const COMMANDS: SlashCommand[] = [
  { command: "/compact", hint: "Summarize the conversation to free context" },
];

function withSkills(message: string, skills: string[] = []): string {
  return skills.length > 0 ? `${skills.map((name) => `/${name}`).join(" ")} ${message}` : message;
}

const COMPACT = /^\/compact(?:\s+([\s\S]+))?$/;

interface ThreadData {
  turnCount?: number;
  stopped?: string[];
}

interface Live {
  nativeId: string;
  ref: number;
  row: IndexedThread;
  state: PiChatState | undefined;
  watching: Promise<void> | undefined;
  stopWatch: (() => Promise<void>) | undefined;
  epoch: number;
  feed: ThreadFeed;
  shown: Set<string>;
  published: string;
  working: boolean;
  stopping: boolean;
  costUsd: number;
  notified: Set<string>;
  chain: Promise<void>;
  writes: Promise<void>;
}

function dataOf(row: IndexedThread): ThreadData {
  return row.data as ThreadData;
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return (PERMISSION_MODES as readonly unknown[]).includes(value);
}

function modeOf(row: IndexedThread): PermissionMode {
  return isPermissionMode(row.permissionMode) ? row.permissionMode : DEFAULT_PERMISSION_MODE;
}

function trailingUnanswered(state: PiChatState): string[] {
  const ids: string[] = [];
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i]!;
    if (message.role === "marker") continue;
    if (message.role !== "user" || message.status !== "unanswered") break;
    ids.push(message.id);
  }
  return ids;
}

function answersFor(call: PiToolCall, answers: Record<string, string>): PiAnswer[] {
  return (call.questions ?? []).map((asked) => {
    const answer = answers[asked.question];
    if (answer === undefined) return { selected: [] };
    const picked = (asked.options ?? []).some((option) => option.label === answer);
    return picked ? { selected: [answer] } : { selected: [], text: answer };
  });
}

export function createPiHarness(options: PiHarnessOptions): HarnessInstance {
  const instanceId = options.id ?? "pi";
  const { host, port } = options;
  const log = host.logger;
  const events = new Emitter<InstanceEvent>((error) =>
    log.warn("native listener failed", { error: String(error) }),
  );
  const threads = new Map<string, Promise<Live | undefined>>();
  const known = new Set<string>();
  let ready: Promise<void> | undefined;
  let offActivity: (() => void) | undefined;

  const logFailure = (what: string, nativeId: string) => (error: unknown) =>
    log.warn(`native ${what} failed`, { nativeId, error: String(error) });

  function liveOf(nativeId: string): Promise<Live | undefined> {
    let pending = threads.get(nativeId);
    if (!pending) {
      pending = host.index.get(instanceId, nativeId).then((row) => {
        if (!row || !/^\d+$/.test(nativeId)) {
          threads.delete(nativeId);
          return undefined;
        }
        return {
          nativeId,
          ref: Number(nativeId),
          row,
          state: undefined,
          watching: undefined,
          stopWatch: undefined,
          epoch: 0,
          feed: new ThreadFeed(logFailure("watcher", nativeId)),
          shown: new Set<string>(),
          published: "",
          working: false,
          stopping: false,
          costUsd: 0,
          notified: new Set<string>(),
          chain: Promise.resolve(),
          writes: Promise.resolve(),
        };
      });
      threads.set(nativeId, pending);
    }
    return pending;
  }

  async function threadOf(nativeId: string): Promise<Live> {
    const live = await liveOf(nativeId);
    if (!live) throw notFound(`No native thread ${nativeId}.`);
    return live;
  }

  function enqueue(live: Live, work: () => unknown): Promise<void> {
    live.chain = live.chain
      .then(async () => {
        await work();
      })
      .catch(logFailure("event", live.nativeId));
    return live.chain;
  }

  function saveRow(
    live: Live,
    patch: (row: IndexedThread) => Partial<IndexedThread> | undefined,
  ): Promise<void> {
    const write = live.writes.then(async () => {
      const next = patch(live.row);
      if (!next) return;
      live.row = await host.index.upsert({
        ...next,
        instanceId,
        nativeId: live.nativeId,
      });
    });
    live.writes = write.catch(logFailure("index write", live.nativeId));
    return write;
  }

  function saveData(live: Live, patch: Partial<ThreadData>): Promise<void> {
    return saveRow(live, (row) => ({ data: { ...row.data, ...patch } }));
  }

  function defaultModel(): ModelOption | undefined {
    const models = port.models();
    return models.find((model) => model.isDefault) ?? models[0];
  }

  function configOf(row: Pick<IndexedThread, "model" | "cwd" | "permissionMode">): PiThreadConfig {
    if (!row.cwd) throw badRequest("This native thread has no working directory.");
    const modelId = row.model ?? defaultModel()?.id;
    if (!modelId) {
      throw badRequest("No model can run the native agent. Add one in Settings → Models.");
    }
    return {
      modelId,
      cwd: row.cwd,
      permissionMode: isPermissionMode(row.permissionMode)
        ? row.permissionMode
        : DEFAULT_PERMISSION_MODE,
    };
  }

  function settingsOf(row: IndexedThread): ThreadSettings {
    return { model: row.model, effort: null, permissionMode: modeOf(row) };
  }

  function contextOf(row: IndexedThread): { used: number; max?: number } {
    const id = row.model ?? defaultModel()?.id;
    const max = port.models().find((model) => model.id === id)?.contextWindow;
    return { used: 0, ...(max ? { max } : {}) };
  }

  function summaryOf(
    row: IndexedThread,
    now: { working: boolean; cursor?: number; queued?: number },
  ): ThreadSummary {
    return {
      id: threadIdOf(instanceId, row.nativeId),
      instanceId,
      kind: "pi",
      nativeId: row.nativeId,
      title: row.title || "Native",
      cwd: row.cwd,
      model: row.model,
      parentId: row.parentNativeId ? threadIdOf(instanceId, row.parentNativeId) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      working: now.working,
      archived: row.archived,
      cursor: now.cursor ?? dataOf(row).turnCount ?? 0,
      permissionMode: modeOf(row),
      ...(now.queued ? { queuedCount: now.queued } : {}),
    };
  }

  function transcriptOf(live: Live, state: PiChatState): PiTranscript {
    return normalizeChat(state, new Set(dataOf(live.row).stopped));
  }

  function threadNow(live: Live, state: PiChatState, view: PiTranscript): ThreadSummary {
    return summaryOf(live.row, {
      working: state.busy,
      cursor: view.turns,
      queued: state.queued.length,
    });
  }

  function snapshotOf(live: Live, state: PiChatState, view: PiTranscript): ThreadSnapshot {
    return {
      thread: threadNow(live, state, view),
      items: view.items,
      settings: settingsOf(live.row),
      queued: queuedOf(state.queued, host.now()),
      jobs: [],
      children: [],
      context: contextOf(live.row),
      costUsd: live.costUsd,
    };
  }

  function outcomeOf(live: Live, state: PiChatState, view: PiTranscript): TurnOutcome {
    return turnOutcome({
      thread: threadNow(live, state, view),
      items: view.items,
      endedAt: view.endedAt ?? live.row.updatedAt.getTime(),
    });
  }

  function emitState(live: Live, state: PiChatState): void {
    live.feed.state({
      working: state.busy,
      context: contextOf(live.row),
      queued: queuedOf(state.queued, host.now()),
      jobs: [],
      settings: settingsOf(live.row),
      costUsd: live.costUsd,
    });
  }

  async function refreshCost(live: Live): Promise<void> {
    live.costUsd = await port.costUsd(live.ref);
  }

  async function markStopped(live: Live, state: PiChatState): Promise<void> {
    const stopped = dataOf(live.row).stopped ?? [];
    const fresh = trailingUnanswered(state).filter((id) => !stopped.includes(id));
    if (fresh.length === 0) return;
    await saveData(live, {
      stopped: [...stopped, ...fresh].slice(-STOPPED_KEPT),
    });
  }

  async function sync(live: Live): Promise<void> {
    const state = live.state;
    if (!state) return;
    if (live.stopping) await markStopped(live, state);
    if (!state.busy) live.stopping = false;
    const view = transcriptOf(live, state);
    const ids = new Set(view.items.map((item) => item.id));
    const removed = [...live.shown].some((id) => !ids.has(id));
    live.shown = ids;
    const reported = dataOf(live.row).turnCount ?? 0;
    const ended = !state.busy && (live.working || view.turns > reported);
    if (ended) await refreshCost(live).catch(logFailure("usage read", live.nativeId));
    if (removed) live.feed.snapshot(snapshotOf(live, state, view));
    else live.feed.items(view.items, view.turns);
    if (state.busy) live.feed.partial(view.partial);
    const published = JSON.stringify([state.busy, state.queued]);
    if (published !== live.published) {
      live.published = published;
      emitState(live, state);
    }
    for (const request of view.requests) {
      if (live.notified.has(request.id)) continue;
      live.notified.add(request.id);
      events.emit({
        type: "attention",
        nativeId: live.nativeId,
        text: request.text,
        key: request.id,
      });
    }
    if (state.busy && !live.working) {
      live.working = true;
      events.emit({ type: "threads" });
    }
    if (ended) {
      live.working = false;
      await saveRow(live, (row) => ({
        updatedAt: host.now(),
        data: { ...row.data, turnCount: view.turns },
      }));
      events.emit({ type: "threads" });
      events.emit({
        type: "turn_ended",
        nativeId: live.nativeId,
        outcome: outcomeOf(live, state, view),
      });
      await release(live);
    }
  }

  async function release(live: Live): Promise<void> {
    if (live.working || live.state?.busy || live.feed.size > 0) return;
    await detach(live);
  }

  function attach(live: Live): Promise<void> {
    if (!live.watching) {
      const epoch = ++live.epoch;
      const apply = (changes: PiChatEvent[]) =>
        enqueue(live, () => {
          if (epoch !== live.epoch) return;
          live.state = applyChatEvents(live.state, changes);
          return sync(live);
        });
      const watching = port
        .watch(live.ref, (changes) => void apply(changes))
        .then((subscription) => {
          if (epoch === live.epoch) live.stopWatch = subscription.stop;
          else void subscription.stop().catch(logFailure("unwatch", live.nativeId));
        });
      live.watching = watching;
      watching.catch((error: unknown) => {
        if (live.watching === watching) live.watching = undefined;
        logFailure("watch", live.nativeId)(error);
      });
    }
    return live.watching.then(() => live.chain);
  }

  async function detach(live: Live): Promise<void> {
    const stop = live.stopWatch;
    if (!stop) return;
    live.epoch++;
    live.watching = undefined;
    live.stopWatch = undefined;
    live.state = undefined;
    live.shown = new Set();
    live.published = "";
    await stop().catch(logFailure("unwatch", live.nativeId));
  }

  async function stateOf(live: Live): Promise<PiChatState> {
    await live.chain;
    return live.state ?? port.read(live.ref);
  }

  function onActivity(change: { conversation: number; busy: boolean }): void {
    const nativeId = String(change.conversation);
    void (ready ?? Promise.resolve())
      .then(async () => {
        if (!known.has(nativeId)) return;
        const live = await liveOf(nativeId);
        if (!live) return;
        if (change.busy) await attach(live);
        else await enqueue(live, () => release(live));
      })
      .catch(logFailure("activity", nativeId));
  }

  async function openCall(
    live: Live,
    requestId: string,
  ): Promise<{ call: PiToolCall; taskId: number }> {
    const state = await stateOf(live);
    for (const message of state.messages) {
      const at = (message.toolCalls ?? []).findIndex(
        (_call, index) => requestIdOf(message.id, index) === requestId,
      );
      const call = at >= 0 ? message.toolCalls![at] : undefined;
      if (!call) continue;
      if (call.taskId === undefined) break;
      return { call, taskId: call.taskId };
    }
    throw new HarnessError(409, "That request is no longer waiting for an answer.");
  }

  const instance: HarnessInstance = {
    id: instanceId,
    kind: "pi",
    label: "Native",

    capabilities: () => CAPABILITIES,

    start() {
      if (ready) return;
      offActivity = port.onActivity(onActivity);
      ready = host.index
        .list(instanceId)
        .then((rows) => {
          for (const row of rows) known.add(row.nativeId);
          events.emit({ type: "connected" });
        })
        .catch(logFailure("start", instanceId));
    },

    stop() {
      offActivity?.();
      offActivity = undefined;
      ready = undefined;
      for (const pending of threads.values()) {
        void pending.then((live) => (live ? detach(live) : undefined));
      }
      threads.clear();
      known.clear();
    },

    status: () => (ready ? { state: "connected" } : { state: "disabled", detail: "Not started." }),

    subscribe: (listener) => events.add(listener),

    async listThreads(view) {
      const rows = await host.index.list(instanceId);
      return rows
        .filter((row) => row.archived === (view === "archived"))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .map((row) => summaryOf(row, { working: port.isBusy(Number(row.nativeId)) }));
    },

    async getThread(nativeId) {
      const live = await threadOf(nativeId);
      const state = await stateOf(live);
      await refreshCost(live);
      const view = transcriptOf(live, state);
      return snapshotOf(live, state, view);
    },

    watchThread(nativeId, listener) {
      let stopped = false;
      let leave: (() => void) | undefined;
      void (async () => {
        const live = await threadOf(nativeId);
        if (stopped) return;
        const unsubscribe = live.feed.subscribe(listener);
        leave = () => {
          unsubscribe();
          void enqueue(live, () => release(live));
        };
        try {
          await refreshCost(live);
          await attach(live);
        } catch (error) {
          live.feed.error(
            `Could not read the transcript: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
        await enqueue(live, () => {
          const state = live.state;
          if (stopped || !state || !live.feed.waiting) return;
          const view = transcriptOf(live, state);
          live.shown = new Set(view.items.map((item) => item.id));
          live.feed.snapshot(snapshotOf(live, state, view), "waiting");
        });
      })().catch((error: unknown) => {
        try {
          listener({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        } catch (failure) {
          logFailure("watcher", nativeId)(failure);
        }
      });
      return () => {
        stopped = true;
        leave?.();
      };
    },

    async outcome(nativeId) {
      const live = await threadOf(nativeId);
      const state = await stateOf(live);
      return outcomeOf(live, state, transcriptOf(live, state));
    },

    async createThread(input) {
      const cwd = input.cwd?.trim();
      if (!cwd) throw badRequest("The native agent needs a working directory.");
      if (!cwd.startsWith("/")) {
        throw badRequest("The working directory must be an absolute path on the sandbox.");
      }
      if (input.attachments?.length) throw badRequest("Native threads take no attachments yet.");
      const model = input.model?.trim() || null;
      if (model && !port.models().some((option) => option.id === model)) {
        throw badRequest(`The native agent cannot run the model "${model}".`);
      }
      const permissionMode = input.permissionMode ?? DEFAULT_PERMISSION_MODE;
      const ref = await port.create(configOf({ model, cwd, permissionMode }));
      const nativeId = String(ref);
      const now = host.now();
      await host.index.upsert({
        instanceId,
        nativeId,
        title: firstLine(input.message.trim(), 100) || "New thread",
        cwd,
        parentNativeId: null,
        model,
        effort: null,
        permissionMode,
        archived: false,
        createdAt: now,
        updatedAt: now,
        data: {},
      });
      known.add(nativeId);
      try {
        await instance.send(nativeId, { message: input.message });
      } catch (error) {
        await host.index.remove(instanceId, nativeId);
        known.delete(nativeId);
        threads.delete(nativeId);
        throw error;
      }
      events.emit({ type: "threads" });
      return { nativeId };
    },

    async archive(nativeId, archived) {
      const live = await threadOf(nativeId);
      await saveRow(live, () => ({ archived }));
      events.emit({ type: "threads" });
      return { moved: [nativeId] };
    },

    async rename(nativeId, title) {
      const live = await threadOf(nativeId);
      const clean = title.trim();
      if (!clean) throw badRequest("A title cannot be empty.");
      await saveRow(live, () => ({ title: clean.slice(0, 200) }));
      const state = await stateOf(live);
      live.feed.thread(threadNow(live, state, transcriptOf(live, state)));
      events.emit({ type: "threads" });
    },

    async forkBefore(nativeId, at) {
      const state = await stateOf(await threadOf(nativeId));
      const index = state.messages.findIndex((message) => message.id === at);
      const before = index > 0 ? state.messages[index - 1]?.id : undefined;
      if (!before) {
        throw badRequest("The first message of a thread cannot be edited. Start a new thread.");
      }
      return this.fork!(nativeId, before);
    },

    async fork(nativeId, at) {
      const live = await threadOf(nativeId);
      const state = await stateOf(live);
      const point = at || state.messages.findLast((message) => /^e\d+$/.test(message.id))?.id;
      if (!point) throw badRequest("There is nothing to fork yet.");
      const forkRef = await port.fork(live.ref, point);
      const forkId = String(forkRef);
      const forked = normalizeChat(await port.read(forkRef), new Set());
      const { row } = live;
      const now = host.now();
      await host.index.upsert({
        instanceId,
        nativeId: forkId,
        title: `${row.title || "Native"} (fork)`,
        cwd: row.cwd,
        parentNativeId: nativeId,
        model: row.model,
        effort: null,
        permissionMode: row.permissionMode,
        archived: false,
        createdAt: now,
        updatedAt: now,
        data: { turnCount: forked.turns } satisfies ThreadData,
      });
      known.add(forkId);
      events.emit({ type: "threads" });
      return { nativeId: forkId };
    },

    async send(nativeId, input) {
      const live = await threadOf(nativeId);
      const compact = COMPACT.exec(input.message.trim());
      if (compact) {
        await port.compact(live.ref, compact[1]?.trim() || undefined);
        return { status: "accepted" };
      }
      if (input.attachments?.length) throw badRequest("Native threads take no attachments yet.");
      await port.configure(live.ref, configOf(live.row));
      await attach(live);
      const busy = live.state?.busy ?? false;
      try {
        await port.submit(live.ref, {
          requestId: randomUUID(),
          text: withSkills(input.message, input.skills),
          whenBusy: input.queue ? "followUp" : "steer",
        });
      } catch (error) {
        await enqueue(live, () => release(live));
        throw error;
      }
      await saveRow(live, () => ({ updatedAt: host.now() }));
      return { status: busy && input.queue ? "queued" : "accepted" };
    },

    async interrupt(nativeId) {
      const live = await threadOf(nativeId);
      await attach(live);
      live.stopping = live.state?.busy ?? false;
      try {
        await port.abort(live.ref);
      } catch (error) {
        live.stopping = false;
        throw error;
      } finally {
        await enqueue(live, () => release(live));
      }
    },

    async respond(nativeId, requestId, answer: RequestAnswer) {
      const live = await threadOf(nativeId);
      const { call, taskId } = await openCall(live, requestId);
      if ("decision" in answer) {
        await port.decideApproval(
          live.ref,
          taskId,
          answer.decision === "allow" ? "approved" : "denied",
        );
        return;
      }
      await port.answerQuestions(live.ref, taskId, answersFor(call, answer.answers));
    },

    async recover(nativeId, action) {
      if (action !== "continue") throw capabilityMissing(action);
      const live = await threadOf(nativeId);
      await port.configure(live.ref, configOf(live.row));
      await attach(live);
      await port.continueReply(live.ref);
    },

    async queued(nativeId, action, queuedId) {
      const live = await threadOf(nativeId);
      const item = (await stateOf(live)).queued.find((queued) => queued.requestId === queuedId);
      if (!item) throw notFound("That message is no longer queued.");
      if (action === "send" && item.mode === "steer") return;
      const outcome = await port.withdraw(live.ref, queuedId);
      if (action === "cancel" || outcome !== "withdrawn") return;
      await port.submit(live.ref, {
        requestId: randomUUID(),
        text: item.text,
        whenBusy: "steer",
      });
    },

    async updateSettings(nativeId, change) {
      const live = await threadOf(nativeId);
      const patch: Partial<IndexedThread> = {};
      if (change.model !== undefined) {
        const model = change.model?.trim() || null;
        if (model && !port.models().some((option) => option.id === model)) {
          throw badRequest(`The native agent cannot run the model "${model}".`);
        }
        patch.model = model;
      }
      if (change.effort) throw badRequest("The native agent has no effort levels.");
      if (change.permissionMode !== undefined) {
        if (change.permissionMode !== null && !isPermissionMode(change.permissionMode)) {
          throw badRequest(
            `Unknown permission mode "${String(change.permissionMode)}". Use one of: ${PERMISSION_MODES.join(", ")}.`,
          );
        }
        patch.permissionMode = change.permissionMode;
      }
      await port.configure(live.ref, configOf({ ...live.row, ...patch }));
      await saveRow(live, () => patch);
      if (live.state) emitState(live, live.state);
      return settingsOf(live.row);
    },

    async models() {
      return port.models();
    },

    commands: () => COMMANDS,
    skills: (cwd) => port.skills(cwd),
  };
  return instance;
}
