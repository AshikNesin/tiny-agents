import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  Harness,
  MemoryStorage,
  watchEvents,
  type AgentEvent,
  type Conversation,
  type ConversationId,
  type EntryRecord,
  type HarnessSettings,
  type MessageChange,
  type Storage,
  type TaskGraphWatch,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { acquireStoreLock, type StoreLock } from "./lock";
import { createGatewayModels, GATEWAY_PROVIDER, toModelInfo } from "./models";
import { chatState, diffChat, type RawChat } from "./transcript";
import type {
  ActivityChange,
  BotAgentConfig,
  ChatEvent,
  ChatState,
  ChatSubscription,
  ConversationRef,
  LastMessage,
  ModelInfo,
} from "./types";

const ctx: Context = BACKGROUND_CONTEXT;

/** Most recent entries loaded into a chat snapshot. */
const HISTORY_LIMIT = 1000;

/** Task kinds that mean "the bot is replying" (background compaction does not). */
const REPLY_TASK_KINDS = new Set(["pi.generation", "pi.tool"]);

export class ConversationNotFoundError extends Error {
  constructor(ref: ConversationRef) {
    super(`Conversation ${ref} not found`);
    this.name = "ConversationNotFoundError";
  }
}

export interface AgentRuntimeOptions {
  /** Path of the pi-durable SQLite store, or ":memory:" (tests). */
  storePath: string;
  /** Model registry; defaults to the Cloudflare AI Gateway provider only. */
  models?: MutableModels;
  /** Provider id bots' models resolve against. Defaults to the gateway. */
  provider?: string;
  /** How long to wait for another process to release the store lock. */
  lockWaitMs?: number;
  /** pi-durable run policy overrides (compaction, retry, progress). */
  settings?: HarnessSettings;
  /** Non-fatal errors pi-durable reports (hooks, listeners, …). */
  onReport?: (error: unknown) => void;
  /** The Harness failed (storage error) and closed itself. The host should exit/restart. */
  onFatal?: (error: unknown) => void;
}

/**
 * The single owner of pi-durable in tiny-agents (PRD §7.2). One instance per
 * process, opened at boot before the HTTP server accepts requests.
 */
export class AgentRuntime {
  readonly provider: string;
  readonly #harness: Harness;
  readonly #models: MutableModels;
  readonly #lock: StoreLock | undefined;
  readonly #chats = new Set<ChatSubscription>();
  readonly #activityListeners = new Set<(change: ActivityChange) => void>();
  #busy = new Set<ConversationRef>();
  #graph: TaskGraphWatch | undefined;
  #closed = false;

  private constructor(
    harness: Harness,
    models: MutableModels,
    provider: string,
    lock: StoreLock | undefined,
  ) {
    this.#harness = harness;
    this.#models = models;
    this.provider = provider;
    this.#lock = lock;
  }

  /**
   * Lock the store, open the Harness and resume interrupted work. Throws
   * `StoreLockedError` when another process owns the store.
   */
  static async open(options: AgentRuntimeOptions): Promise<AgentRuntime> {
    const inMemory = options.storePath === ":memory:";
    const lock = inMemory
      ? undefined
      : acquireStoreLock(options.storePath, { waitMs: options.lockWaitMs });
    try {
      const storage: Storage = inMemory
        ? new MemoryStorage()
        : await openNodeSqliteStorage(options.storePath);
      const models = options.models ?? createGatewayModels();
      const harness = await Harness.open(
        storage,
        {
          models,
          registry: createRegistry(),
          settings: { compaction: { enabled: true }, ...options.settings },
          onReport: options.onReport,
        },
        ctx,
      );
      const runtime = new AgentRuntime(harness, models, options.provider ?? GATEWAY_PROVIDER, lock);
      harness.closed.then((end) => {
        if (end.reason === "failed" && !runtime.#closed) options.onFatal?.(end.error);
      });
      await runtime.#watchActivity();
      harness.resume();
      return runtime;
    } catch (error) {
      lock?.release();
      throw error;
    }
  }

  // ── Models ────────────────────────────────────────────────────────────

  listModels(): ModelInfo[] {
    return this.#models.getModels(this.provider).map(toModelInfo);
  }

  hasModel(modelId: string): boolean {
    return this.#models.getModel(this.provider, modelId) !== undefined;
  }

  // ── Conversations ─────────────────────────────────────────────────────

  async createConversation(config: BotAgentConfig): Promise<ConversationRef> {
    const conversation = await this.#harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: this.provider, modelId: config.modelId },
          instructions: config.systemPrompt.trim() ? config.systemPrompt : null,
        },
      },
      ctx,
    );
    return Number(conversation.id);
  }

  /** Change persona/model. Applies from the next model request; history is kept. */
  async configure(ref: ConversationRef, config: BotAgentConfig): Promise<void> {
    const conversation = await this.#conversation(ref);
    await conversation.configure(
      {
        model: { provider: this.provider, modelId: config.modelId },
        instructions: config.systemPrompt.trim() ? config.systemPrompt : null,
      },
      ctx,
    );
  }

  /**
   * Durably admit a user message. Retrying with the same `requestId` never
   * submits twice. While a reply is running, the message is queued as a
   * follow-up and answered next.
   */
  async submit(ref: ConversationRef, input: { requestId: string; text: string }): Promise<void> {
    const conversation = await this.#conversation(ref);
    await conversation.submit(
      { type: "input", content: input.text, requestId: input.requestId },
      ctx,
    );
  }

  /** Stop the in-flight reply (and withdraw queued inputs). */
  async abort(ref: ConversationRef): Promise<void> {
    const conversation = await this.#conversation(ref);
    await conversation.abort(ctx);
  }

  isBusy(ref: ConversationRef): boolean {
    return this.#busy.has(ref);
  }

  busyConversations(): ConversationRef[] {
    return [...this.#busy];
  }

  async lastMessage(ref: ConversationRef): Promise<LastMessage | undefined> {
    const conversation = await this.#conversation(ref);
    const page = await conversation.entries({ order: "descending" }, 20, undefined, ctx);
    for (const entry of page.items) {
      const message = entry.model?.[0];
      if (!message) continue;
      if (entry.kind === "pi.user" && message.role === "user") {
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content
                .filter((b) => b.type === "text")
                .map((b) => (b as { text: string }).text)
                .join("");
        return { role: "user", text, createdAt: message.timestamp ?? Date.now() };
      }
      if (entry.kind === "pi.assistant" && message.role === "assistant") {
        const text = message.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("");
        const shown =
          message.stopReason === "error" ? `⚠ ${message.errorMessage || "Model error"}` : text;
        return { role: "assistant", text: shown, createdAt: message.timestamp ?? Date.now() };
      }
    }
    return undefined;
  }

  /**
   * Watch a conversation as chat events: a `snapshot` first, then minimal
   * upserts/deltas per commit. Reconnecting clients simply watch again.
   */
  async watchChat(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
  ): Promise<ChatSubscription> {
    const conversation = await this.#conversation(ref);
    const stream = await watchEvents(this.#harness, ref as ConversationId, ctx);

    const raw: {
      entries: Map<number, EntryRecord>;
      live?: AssistantMessage;
      busy: boolean;
      unanswered: Map<number, string>;
    } = {
      entries: new Map(),
      live: stream.snapshot.generation?.message
        ? structuredClone(stream.snapshot.generation.message)
        : undefined,
      busy: stream.snapshot.run !== undefined,
      unanswered: new Map(),
    };
    for (const entry of await loadHistory(conversation)) raw.entries.set(Number(entry.id), entry);
    for (const entry of stream.snapshot.entries) raw.entries.set(Number(entry.id), entry);

    const view = (): RawChat => ({
      entries: [...raw.entries.values()],
      live: raw.live,
      busy: raw.busy,
      unanswered: raw.unanswered,
    });

    let state: ChatState = chatState(view());
    const initial = state;
    let stopped = false;

    const subscription: ChatSubscription = {
      initial,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        this.#chats.delete(subscription);
        await stream.stop();
      },
    };
    this.#chats.add(subscription);

    await listener([{ type: "snapshot", state }]);

    stream.start(async (events) => {
      if (stopped) return;
      let resnapshot = false;
      for (const event of events) {
        if (event.type === "snapshot") {
          resnapshot = true;
          raw.entries.clear();
          for (const entry of await loadHistory(conversation)) {
            raw.entries.set(Number(entry.id), entry);
          }
          for (const entry of event.entries) raw.entries.set(Number(entry.id), entry);
          raw.live = event.generation?.message
            ? structuredClone(event.generation.message)
            : undefined;
          raw.busy = event.run !== undefined;
          continue;
        }
        applyEvent(raw, event);
      }
      const next = chatState(view());
      const diff = resnapshot
        ? [{ type: "snapshot", state: next } as ChatEvent]
        : diffChat(state, next);
      state = next;
      if (diff.length > 0) await listener(diff);
    });

    return subscription;
  }

  // ── Activity (bot list "typing…") ─────────────────────────────────────

  onActivity(listener: (change: ActivityChange) => void): () => void {
    this.#activityListeners.add(listener);
    return () => this.#activityListeners.delete(listener);
  }

  async #watchActivity(): Promise<void> {
    const graph = await this.#harness.watchTaskGraph(ctx);
    this.#graph = graph;
    this.#busy = busyFromGraph(graph.value);
    graph.start(async (value) => {
      const next = busyFromGraph(value);
      const changes: ActivityChange[] = [];
      for (const ref of next)
        if (!this.#busy.has(ref)) changes.push({ conversation: ref, busy: true });
      for (const ref of this.#busy)
        if (!next.has(ref)) changes.push({ conversation: ref, busy: false });
      this.#busy = next;
      for (const change of changes) {
        for (const listener of this.#activityListeners) {
          try {
            listener(change);
          } catch {
            // listeners must not break the activity feed
          }
        }
      }
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Stop watches, close the Harness (waits for running task code) and release the lock. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled([...this.#chats].map((chat) => chat.stop()));
    await this.#graph?.stop().catch(() => undefined);
    try {
      await this.#harness.close(ctx);
    } finally {
      this.#lock?.release();
    }
  }

  async #conversation(ref: ConversationRef): Promise<Conversation> {
    const conversation = await this.#harness.conversation(ref as ConversationId, ctx);
    if (!conversation) throw new ConversationNotFoundError(ref);
    return conversation;
  }
}

function busyFromGraph(value: TaskGraphWatch["value"]): Set<ConversationRef> {
  const busy = new Set<ConversationRef>();
  for (const node of Object.values(value.tasks)) {
    if (REPLY_TASK_KINDS.has(node.kind)) busy.add(Number(node.conversationId));
  }
  return busy;
}

async function loadHistory(conversation: Conversation): Promise<EntryRecord[]> {
  const page = await conversation.entries({ order: "descending" }, HISTORY_LIMIT, undefined, ctx);
  return [...page.items].reverse();
}

type MutableRaw = {
  entries: Map<number, EntryRecord>;
  live?: AssistantMessage;
  busy: boolean;
  unanswered: Map<number, string>;
};

function applyEvent(raw: MutableRaw, event: AgentEvent): void {
  switch (event.type) {
    case "message_start":
      if (event.message.role === "assistant") raw.live = structuredClone(event.message);
      break;
    case "message_update":
      if (raw.live) for (const change of event.changes) raw.live = applyChange(raw.live, change);
      break;
    case "message_end":
      raw.entries.set(Number(event.entry.id), event.entry);
      if (event.entry.kind === "pi.assistant") raw.live = undefined;
      break;
    case "entry_appended":
      raw.entries.set(Number(event.entry.id), event.entry);
      break;
    case "run_start":
      raw.busy = true;
      break;
    case "run_end":
      raw.busy = false;
      raw.live = undefined;
      break;
    case "submission":
      if (
        event.record.type === "input" &&
        event.record.status === "unanswered" &&
        event.record.entry !== undefined
      ) {
        raw.unanswered.set(Number(event.record.entry), event.record.reason);
      }
      break;
    default:
      break;
  }
}

function applyChange(message: AssistantMessage, change: MessageChange): AssistantMessage {
  if (change.type === "message") return structuredClone(change.message);
  const content = [...message.content];
  switch (change.type) {
    case "text_start":
    case "thinking_start":
    case "toolcall_start":
    case "block":
      content[change.contentIndex] = structuredClone(change.block);
      break;
    case "text_delta": {
      const block = content[change.contentIndex];
      content[change.contentIndex] =
        block?.type === "text"
          ? { ...block, text: block.text + change.delta }
          : { type: "text", text: change.delta };
      break;
    }
    case "thinking_delta": {
      const block = content[change.contentIndex];
      content[change.contentIndex] =
        block?.type === "thinking"
          ? { ...block, thinking: block.thinking + change.delta }
          : { type: "thinking", thinking: change.delta };
      break;
    }
    default:
      break;
  }
  return { ...message, content };
}
