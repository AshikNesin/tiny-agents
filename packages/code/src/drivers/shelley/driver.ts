/**
 * The Shelley harness (ADR 0009, ADR 0011): Shelley owns every conversation
 * and its transcript; this driver reads them live from Shelley's official
 * HTTP/SSE API and normalizes them at the boundary. Shelley admin
 * (profiles, models, MCP, integrations) and terminals stay in Shelley's own
 * UI ("Open in Shelley").
 */
import {
  NO_CAPABILITIES,
  threadIdOf,
  type BackgroundJob,
  type Capabilities,
  type CreateThreadInput,
  type HarnessHost,
  type HarnessInstance,
  type InstanceEvent,
  type ModelOption,
  type SendInput,
  type ThreadSettings,
  type ThreadSnapshot,
  type ThreadSummary,
  type TurnOutcome,
} from "../../contracts";
import { badGateway, badRequest } from "../../server/errors";
import { NO_PARTIAL, ThreadFeed } from "../../server/feed";
import { Emitter } from "../../server/items";
import { turnOutcome } from "../../server/outcome";
import {
  encodePath,
  qs,
  shelleyFetch,
  shelleyJson,
  trimUrl,
  type FetchLike,
  type ShelleyDeps,
} from "./client";
import {
  assetPath,
  buildTranscript,
  lastWriteAt,
  maxSequence,
  messageUserText,
  queuedMessages,
  totalCost,
} from "./normalize";
import { createShelleyStream, type ShelleyStream, type StreamOptions } from "./stream";
import { distinctModels, otherUsageEntries, usageEntries, usageReport } from "./usage";
import {
  isWorking,
  type ModelCost,
  type ShelleyDetail,
  type ShelleyMessage,
  type ShelleyModel,
  type ShelleyRow,
  type ShelleySettings,
  type SubagentUsage,
} from "./wire";

export const SHELLEY_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const SLASH_COMMANDS = [
  { command: "/model", hint: "Show or switch the model and reasoning (e.g. /model sonnet high)" },
  { command: "/compact", hint: "Compact the context to free room" },
  { command: "/btw", hint: "Ask a side question without disturbing the turn" },
  { command: "/fork", hint: "Continue in a copy of this conversation" },
  { command: "/cwd", hint: "Change the working directory" },
  { command: "/new", hint: "Start a new conversation" },
  { command: "/help", hint: "List Shelley's commands" },
];

export interface ShelleyHarnessOptions {
  /** Instance id; default `shelley`. */
  id?: string;
  url: string;
  host: HarnessHost;
  fetch?: FetchLike;
  stream?: Omit<StreamOptions, "deps" | "logger">;
}

export interface ShelleyHarness extends HarnessInstance {
  readonly stream: ShelleyStream;
  /** Shelley's base URL ("Open in Shelley"). */
  readonly url: string;
}

const CAPABILITIES: Capabilities = {
  ...NO_CAPABILITIES,
  turns: {
    interrupt: true,
    steer: true,
    queue: true,
    manageQueue: true,
    recovery: ["retry", "resume", "continue"],
    compact: true,
  },
  threads: {
    fork: true,
    archive: true,
    delete: true,
    rename: true,
    changeCwd: true,
    subagents: true,
    search: true,
    discover: true,
  },
  settings: {
    modelSwitch: true,
    effortLevels: [...SHELLEY_THINKING_LEVELS],
    permissionModes: [],
  },
  approvals: { tools: false, questions: false },
  workspace: {
    diffs: true,
    findFiles: true,
    uploads: true,
    skills: true,
    browse: true,
    worktrees: true,
    requiresCwd: false,
  },
  extras: { jobs: true, usageReport: true, commands: true },
};

/** Every subagent below `id` in `rows` (children, grandchildren, …). */
export function descendantIds(rows: ShelleyRow[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const parent = row.parent_conversation_id;
    if (!parent) continue;
    const list = children.get(parent) ?? [];
    list.push(row.conversation_id);
    children.set(parent, list);
  }
  const found: string[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue; // a cycle in bad data must not loop
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/** `[path]` tokens Shelley reads as attachments. */
function withAttachments(message: string, refs: string[] | undefined): string {
  const paths = (refs ?? [])
    .filter((ref) => ref.startsWith("file:/"))
    .map((ref) => `[${ref.slice(5)}]`);
  if (paths.length === 0) return message;
  return [message.trim(), paths.join(" ")].filter(Boolean).join("\n\n");
}

function settingsOf(raw: ShelleySettings | undefined, row?: ShelleyRow): ThreadSettings {
  return {
    model: raw?.model || row?.model || null,
    effort: raw?.thinking_level || null,
    permissionMode: null,
  };
}

export function createShelleyHarness(options: ShelleyHarnessOptions): ShelleyHarness {
  const id = options.id ?? "shelley";
  const url = trimUrl(options.url);
  if (!url) throw new Error("Shelley needs a URL (SHELLEY_URL).");
  const deps: ShelleyDeps = { config: { url }, fetch: options.fetch };
  const { host } = options;
  const json = <T>(path: string, init: Parameters<typeof shelleyJson>[1] = {}) =>
    shelleyJson<T>(path, init, deps);
  const conv = (nativeId: string) => `/conversation/${encodeURIComponent(nativeId)}`;
  const stream = createShelleyStream({ deps, logger: host.logger, ...options.stream });
  const events = new Emitter<InstanceEvent>((error) =>
    host.logger.warn("A Shelley harness listener failed", { error: String(error) }),
  );

  // Instance events are wired once, for the life of the instance.
  stream.onList(() => events.emit({ type: "threads" }));
  stream.onStatus((status) => events.emit({ type: "status", status }));
  stream.onConnected(() => events.emit({ type: "connected" }));
  // The outcome is read after the end: a queued message may have started the next turn.
  stream.onTurnEnd(({ conversationId: nativeId }) => {
    outcomeOf(nativeId).then(
      (outcome) => events.emit({ type: "turn_ended", nativeId, outcome }),
      (error: unknown) =>
        host.logger.warn("Could not read a Shelley turn's outcome", {
          nativeId,
          error: String(error),
        }),
    );
  });
  stream.subscribe(null, (frame) => {
    const nativeId = frame.conversation_id;
    if (!nativeId || !frame.messages?.length) return;
    for (const message of frame.messages) {
      if (message.type !== "agent" || typeof message.llm_data !== "string") continue;
      const text = messageUserText(message.llm_data);
      if (text) {
        events.emit({
          type: "attention",
          nativeId,
          text,
          key: `${nativeId}:${message.sequence_id}`,
        });
      }
    }
  });

  let modelsPromise: Promise<ShelleyModel[]> | undefined;
  const shelleyModels = (): Promise<ShelleyModel[]> =>
    (modelsPromise ??= json<ShelleyModel[]>("/models")
      .then((list) => (Array.isArray(list) ? list : []))
      .catch((error: unknown) => {
        modelsPromise = undefined;
        throw error;
      }));

  const summary = (row: ShelleyRow): ThreadSummary => ({
    id: threadIdOf(id, row.conversation_id),
    instanceId: id,
    kind: "shelley",
    nativeId: row.conversation_id,
    title: row.slug || row.conversation_id,
    cwd: row.cwd ?? null,
    model: row.model ?? null,
    parentId: row.parent_conversation_id ? threadIdOf(id, row.parent_conversation_id) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    working: isWorking(row),
    archived: Boolean(row.archived),
    cursor: row.max_sequence_id ?? 0,
    ...(row.preview ? { preview: row.preview } : {}),
    ...(row.subagent_count ? { subagentCount: row.subagent_count } : {}),
    ...(row.running_background_jobs ? { runningJobs: row.running_background_jobs } : {}),
    ...(row.queued_messages ? { queuedCount: queuedMessages(row).length } : {}),
    ...(row.turn_interrupted ? { turnInterrupted: true } : {}),
    repoRoot: row.git_repo_root ?? null,
    gitCommit: row.git_commit ?? null,
    gitSubject: row.git_subject ?? null,
    // Shelley's UI addresses conversations by slug.
    ...(row.slug ? { externalUrl: `${url}/c/${encodeURIComponent(row.slug)}` } : {}),
  });

  const rowsOf = (list: unknown): ShelleyRow[] => (Array.isArray(list) ? list : []);

  async function activeRows(): Promise<ShelleyRow[]> {
    if (!stream.list()) await stream.refreshList();
    const rows = stream.list();
    if (!rows) throw badGateway("Shelley's conversation list is not available yet");
    return rows;
  }

  async function jobsOf(nativeId: string): Promise<BackgroundJob[]> {
    const list = await json<Array<{ id: string; command?: string; started_at?: string }>>(
      `${conv(nativeId)}/background-jobs`,
    ).catch(() => []);
    return (Array.isArray(list) ? list : []).map((job) => ({
      id: job.id,
      command: job.command ?? job.id,
      ...(job.started_at ? { startedAt: job.started_at } : {}),
    }));
  }

  async function subagentCost(nativeId: string): Promise<number> {
    const usage = await json<SubagentUsage>(`${conv(nativeId)}/subagent-usage`).catch(() => null);
    return usage ? usage.reported_usd || usage.estimated_usd || 0 : 0;
  }

  interface Loaded {
    detail: ShelleyDetail;
    row: ShelleyRow;
    children: ShelleyRow[];
    settings: ThreadSettings;
    contextMax?: number;
  }

  /** The conversation's row: the list's, updated by a fresher detail read. */
  function rowOf(nativeId: string, detail: ShelleyDetail): ShelleyRow {
    const listed = stream.list()?.find((r) => r.conversation_id === nativeId);
    const row = { ...listed, ...detail.conversation } as ShelleyRow;
    // The detail read is fresher than the list snapshot's `working`.
    if (typeof detail.conversation?.agent_working === "boolean") {
      row.working = detail.conversation.agent_working;
    }
    if (!row.conversation_id) row.conversation_id = nativeId;
    return row;
  }

  async function outcomeOf(nativeId: string): Promise<TurnOutcome> {
    const detail = await json<ShelleyDetail>(conv(nativeId));
    const messages = detail.messages ?? [];
    const row = rowOf(nativeId, detail);
    return turnOutcome({
      thread: summary({
        ...row,
        max_sequence_id: Math.max(row.max_sequence_id ?? 0, maxSequence(messages)),
      }),
      items: buildTranscript(messages, id),
      endedAt: lastWriteAt(messages),
    });
  }

  async function load(nativeId: string): Promise<Loaded> {
    const [detail, children, rawSettings] = await Promise.all([
      json<ShelleyDetail>(conv(nativeId)),
      json<unknown>(`${conv(nativeId)}/subagents`).catch(() => []),
      json<ShelleySettings>(`${conv(nativeId)}/settings`).catch(() => undefined),
    ]);
    const row = rowOf(nativeId, detail);
    const settings = settingsOf(rawSettings, row);
    const models = await shelleyModels().catch(() => [] as ShelleyModel[]);
    const contextMax = models.find((m) => m.id === settings.model)?.max_context_tokens;
    return { detail, row, children: rowsOf(children), settings, contextMax };
  }

  async function snapshotOf(
    nativeId: string,
    loaded: Loaded,
    messages: Iterable<ShelleyMessage>,
    progress: Record<string, string> = {},
  ): Promise<ThreadSnapshot> {
    const { row, children, settings } = loaded;
    const running = row.running_background_jobs ?? 0;
    const [jobs, subCost] = await Promise.all([
      running ? jobsOf(nativeId) : Promise.resolve([]),
      children.length ? subagentCost(nativeId) : Promise.resolve(0),
    ]);
    // Read after the awaits: a live watch's map may have grown meanwhile.
    const list = [...messages];
    return {
      thread: summary({
        ...row,
        max_sequence_id: Math.max(row.max_sequence_id ?? 0, maxSequence(list)),
      }),
      items: buildTranscript(list, id, { progress }),
      settings,
      queued: queuedMessages(row),
      jobs,
      children: children.map(summary),
      context: {
        used: loaded.detail.context_window_size ?? 0,
        ...(loaded.contextMax ? { max: loaded.contextMax } : {}),
      },
      costUsd: totalCost(list) + subCost,
    };
  }

  const instance: ShelleyHarness = {
    id,
    kind: "shelley",
    label: "Shelley",
    stream,
    url,
    capabilities: () => CAPABILITIES,
    start: () => stream.start(),
    stop: () => stream.stop(),
    status: () => stream.status(),
    subscribe: (listener) => events.add(listener),

    async listThreads(view) {
      if (view === "archived") {
        return rowsOf(await json("/conversations/archived")).map(summary);
      }
      return (await activeRows()).map(summary);
    },

    async searchThreads(query, archived) {
      const rows = await json(
        `/conversations/search${qs({ q: query, archived: archived ? "true" : undefined })}`,
      );
      return rowsOf(rows).map(summary);
    },

    async getThread(nativeId) {
      const loaded = await load(nativeId);
      return snapshotOf(nativeId, loaded, loaded.detail.messages ?? []);
    },

    watchThread(nativeId, listener) {
      // One feed per watch: each watch reads the conversation itself.
      const feed = new ThreadFeed((error) =>
        host.logger.warn("A Shelley thread watcher failed", { error: String(error) }),
      );
      const unsubscribe = feed.subscribe(listener);
      let closed = false;
      const messages = new Map<number, ShelleyMessage>();
      const progress: Record<string, string> = {};
      let row: ShelleyRow | undefined;
      let working = false;
      let loaded: Loaded | undefined;
      let lastJobs = -1;

      const merge = (incoming: ShelleyMessage[]) => {
        for (const m of incoming) messages.set(m.sequence_id, m);
      };
      const pushItems = () => {
        if (!feed.live) return;
        feed.items(
          buildTranscript(messages.values(), id, { progress }),
          maxSequence(messages.values()),
        );
      };
      const refreshJobs = (count: number) => {
        if (!feed.live || count === lastJobs) return;
        lastJobs = count;
        if (!count) {
          feed.state({ jobs: [] });
          return;
        }
        void jobsOf(nativeId).then((jobs) => feed.state({ jobs }));
      };

      const off = stream.subscribe(nativeId, (frame) => {
        if (frame.messages?.length) {
          merge(frame.messages);
          pushItems();
          // A finished message replaces the streaming text.
          if (frame.messages.some((m) => m.type === "agent")) feed.partial(NO_PARTIAL);
        }
        if (frame.conversation) {
          row = { ...row, ...frame.conversation };
          if (feed.live) {
            feed.thread(summary(row));
            feed.state({ queued: queuedMessages(row) });
            refreshJobs(row.running_background_jobs ?? 0);
          }
        }
        if (frame.conversation_state) {
          const wasWorking = working;
          working = frame.conversation_state.working;
          feed.state({ working });
          if (wasWorking && !working && feed.live) void sendCost();
        }
        if (frame.context_window_size) {
          feed.state({
            context: {
              used: frame.context_window_size,
              ...(loaded?.contextMax ? { max: loaded.contextMax } : {}),
            },
          });
        }
        const tool = frame.tool_progress;
        if (tool) {
          progress[tool.tool_use_id] = tool.output;
          pushItems();
        }
        const delta = frame.stream_delta;
        const partial = feed.partialNow;
        if (delta?.type === "text") feed.partial({ ...partial, text: partial.text + delta.text });
        else if (delta?.type === "thinking") {
          feed.partial({ ...partial, thinking: partial.thinking + delta.text });
        }
      });

      async function sendCost() {
        if (!loaded) return;
        const sub = loaded.children.length ? await subagentCost(nativeId) : 0;
        feed.state({ costUsd: totalCost(messages.values()) + sub });
      }

      /** Read the conversation and start the watcher over from a snapshot. */
      async function reload() {
        try {
          const next = await load(nativeId);
          if (closed) return;
          loaded = next;
          merge(next.detail.messages ?? []);
          row = { ...row, ...next.row };
          working = isWorking(row);
          const snapshot = await snapshotOf(nativeId, next, messages.values(), progress);
          if (closed) return;
          lastJobs = row.running_background_jobs ?? 0;
          feed.snapshot(snapshot);
        } catch (error) {
          feed.error(error instanceof Error ? error.message : String(error));
        }
      }

      // Re-read after every reconnect: frames sent while the stream was down are gone.
      const offConnected = stream.onConnected(() => void reload());
      void reload();
      return () => {
        closed = true;
        unsubscribe();
        off();
        offConnected();
      };
    },

    outcome: outcomeOf,

    async createThread(input: CreateThreadInput) {
      const created = await json<{ conversation_id?: string }>("/conversations/new", {
        method: "POST",
        json: {
          message: withAttachments(input.message, input.attachments),
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.effort ? { conversation_options: { thinking_level: input.effort } } : {}),
        },
      });
      if (!created.conversation_id) throw badGateway("Shelley did not return a conversation id");
      void stream.refreshList();
      return { nativeId: created.conversation_id };
    },

    /**
     * Shelley archives one conversation at a time; the Code page archives a
     * conversation with its subagents, so a finished task leaves the list
     * whole. Subagents are found in the list they are leaving and moved
     * best-effort after the parent.
     */
    async archive(nativeId, archived) {
      const action = archived ? "archive" : "unarchive";
      let cascade: string[] = [];
      try {
        const rows = archived ? await activeRows() : rowsOf(await json("/conversations/archived"));
        cascade = descendantIds(rows, nativeId);
      } catch {
        cascade = [];
      }
      await json(`${conv(nativeId)}/${action}`, { method: "POST" });
      // One subagent that will not move must not undo the parent's archive.
      const settled = await Promise.allSettled(
        cascade.map((child) => json(`${conv(child)}/${action}`, { method: "POST" })),
      );
      void stream.refreshList();
      return { moved: cascade.filter((_, i) => settled[i]!.status === "fulfilled") };
    },

    async remove(nativeId) {
      await json(`${conv(nativeId)}/delete`, { method: "POST" });
      void stream.refreshList();
    },

    async rename(nativeId, title) {
      await json(`${conv(nativeId)}/rename`, { method: "POST", json: { slug: title } });
      void stream.refreshList();
    },

    async changeCwd(nativeId, cwd) {
      const check = await json<{ valid: boolean; error?: string }>(
        `/validate-cwd${qs({ path: cwd })}`,
      );
      if (!check.valid) throw badRequest(check.error ?? "Not a directory Shelley can use.");
      await json(`${conv(nativeId)}/cwd`, { method: "POST", json: { cwd } });
    },

    async fork(nativeId, at) {
      const forked = await json<{ conversation_id?: string }>(`${conv(nativeId)}/fork`, {
        method: "POST",
        json: { message_id: at },
      });
      if (!forked.conversation_id) throw badGateway("Shelley did not return the fork's id");
      void stream.refreshList();
      return { nativeId: forked.conversation_id };
    },

    externalUrl: (thread) => thread.externalUrl,

    async send(nativeId, input: SendInput) {
      // While a turn runs Shelley injects the message into it (steering);
      // `queue` holds it for when the turn ends.
      const result = await json<{ status?: string }>(`${conv(nativeId)}/chat`, {
        method: "POST",
        json: {
          message: withAttachments(input.message, input.attachments),
          ...(input.queue ? { queue: true } : {}),
          ...(input.skills?.length ? { skills: input.skills } : {}),
        },
      });
      return { status: result.status === "queued" ? "queued" : "accepted" };
    },

    async interrupt(nativeId) {
      await json(`${conv(nativeId)}/cancel`, { method: "POST" });
    },

    async recover(nativeId, action) {
      await json(`${conv(nativeId)}/${action}`, {
        method: "POST",
        ...(action === "continue" ? { json: {} } : {}),
      });
    },

    async queued(nativeId, action, queuedId) {
      const upstream = action === "send" ? "send-queued" : "cancel-queued";
      await json(`${conv(nativeId)}/${upstream}${qs({ queued_id: queuedId })}`, {
        method: "POST",
      });
    },

    async killJob(nativeId, jobId) {
      await json(`${conv(nativeId)}/background-jobs/${encodeURIComponent(jobId)}/kill`, {
        method: "POST",
      });
    },

    async updateSettings(nativeId, change) {
      const next = await json<ShelleySettings>(`${conv(nativeId)}/settings`, {
        method: "POST",
        json: {
          ...(change.model !== undefined ? { model: change.model ?? "" } : {}),
          ...(change.effort !== undefined ? { thinking_level: change.effort ?? "" } : {}),
        },
      });
      return settingsOf(next);
    },

    async usage(nativeId) {
      const detail = await json<ShelleyDetail>(conv(nativeId));
      const messages = detail.messages ?? [];
      const models = distinctModels(usageEntries(messages), otherUsageEntries(messages));
      const [costs, subagents] = await Promise.all([
        models.length
          ? json<{ costs?: Record<string, ModelCost | null> }>("/model-costs", {
              method: "POST",
              json: { models },
            })
              .then((r) => r.costs ?? {})
              .catch(() => null)
          : Promise.resolve({}),
        json<SubagentUsage>(`${conv(nativeId)}/subagent-usage`)
          .then((u) => u.per_model ?? [])
          .catch(() => null),
      ]);
      return usageReport({ messages, costs, subagents });
    },

    async models(): Promise<ModelOption[]> {
      return (await shelleyModels()).map((m) => ({
        id: m.id,
        label: m.display_name || m.id,
        ...(m.is_default ? { isDefault: true } : {}),
        ready: m.ready !== false,
        ...(m.max_context_tokens ? { contextWindow: m.max_context_tokens } : {}),
        ...(m.supports_reasoning !== undefined ? { supportsReasoning: m.supports_reasoning } : {}),
        ...(m.supports_images !== undefined ? { supportsImages: m.supports_images } : {}),
      }));
    },

    commands: () => SLASH_COMMANDS,

    async skills(cwd, nativeId) {
      const result = await json<{ skills?: Array<{ name: string; description?: string }> }>(
        `/skills${qs({ cwd, conversation_id: nativeId })}`,
      );
      return result.skills ?? [];
    },

    async findFiles(dir, query, content) {
      const result = await json<{
        search_dir?: string;
        matches?: Array<{ path: string; is_dir?: boolean; line?: number; text?: string }>;
      }>(
        `/find-files${qs({
          dir,
          q: query || undefined,
          content,
          include_dirs: content ? undefined : "true",
        })}`,
      );
      // Shelley answers relative to the directory it searched (a typed
      // `src/` narrows it); the contract answers relative to `dir`.
      const searched = (result.search_dir ?? dir).replace(/\/$/, "");
      const base = dir.replace(/\/$/, "");
      const prefix =
        searched === base
          ? ""
          : searched.startsWith(`${base}/`)
            ? `${searched.slice(base.length + 1)}/`
            : `${searched}/`;
      return (result.matches ?? []).map((m) => ({
        path: `${prefix}${m.path}`,
        ...(m.is_dir ? { isDir: true } : {}),
        ...(m.line !== undefined ? { line: m.line } : {}),
        ...(m.text !== undefined ? { text: m.text } : {}),
      }));
    },

    async upload(file, filename) {
      const result = await json<{ path?: string }>(`/upload/raw${qs({ filename })}`, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
        timeoutMs: 120_000,
      });
      if (!result.path) throw badGateway("Shelley did not return the uploaded path");
      return { ref: `file:${result.path}` };
    },

    async browse(path) {
      const listing = await json<{
        path: string;
        parent?: string;
        entries?: Array<{ name: string; is_dir: boolean }>;
        git_repo_root?: string;
        git_head_subject?: string;
      }>(`/list-directory${qs({ path })}`);
      return {
        path: listing.path,
        ...(listing.parent ? { parent: listing.parent } : {}),
        entries: (listing.entries ?? []).map((e) => ({ name: e.name, isDir: e.is_dir })),
        ...(listing.git_repo_root ? { repoRoot: listing.git_repo_root } : {}),
        ...(listing.git_head_subject ? { headSubject: listing.git_head_subject } : {}),
      };
    },

    async validateCwd(path) {
      return json<{ valid: boolean; error?: string }>(`/validate-cwd${qs({ path })}`);
    },

    async repos() {
      const result = await json<{ repos?: Array<{ path: string; name?: string }> | null }>(
        "/git/repos",
      );
      return result.repos ?? [];
    },

    async createWorktree(cwd) {
      const created = await json<{ path?: string; worktree?: string; cwd?: string }>(
        "/git/create-worktree",
        { method: "POST", json: { cwd } },
      );
      const path = created.path ?? created.worktree ?? created.cwd;
      if (!path) throw badGateway("Shelley could not create a worktree here.");
      return { path };
    },

    async diffs(cwd) {
      const result = await json<{ diffs?: unknown; gitRoot?: string }>(`/git/diffs${qs({ cwd })}`);
      return {
        diffs: Array.isArray(result.diffs) ? result.diffs : [],
        gitRoot: result.gitRoot ?? cwd,
      };
    },

    async diffFiles(cwd, diffId) {
      const files = await json<unknown>(
        `/git/diffs/${encodeURIComponent(diffId)}/files${qs({ cwd })}`,
      );
      return Array.isArray(files) ? files : [];
    },

    async fileDiff(cwd, diffId, path) {
      return json(`/git/file-diff/${encodeURIComponent(diffId)}/${encodePath(path)}${qs({ cwd })}`);
    },

    async asset(ref) {
      const path = assetPath(ref);
      if (!path) throw badRequest("Unknown asset");
      return shelleyFetch(path, {}, deps);
    },
  };
  return instance;
}
