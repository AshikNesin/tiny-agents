import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";
import {
  configure as configureAgent,
  createRegistry,
  Harness,
  type Extension,
  InboxDoc,
  MemoryStorage,
  watchEvents,
  type AgentChange,
  type AgentEvent,
  type Conversation,
  type ConversationId,
  type Cursor,
  type EntryRecord,
  type HarnessSettings,
  type MessageChange,
  type Registry,
  type Storage,
  type TaskGraphWatch,
  type TaskId,
  type ToolRegistration,
  type ToolSlot,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { ApprovalDoc, gateExtension, PermissionsDoc, type ApprovalDecision } from "./approvals";
import {
  CredentialRequestDoc,
  storedRequest,
  type CredentialRequest,
  type CredentialRequestOutcome,
} from "./credentials";
import { GrantsDoc } from "./vault";
import {
  capabilityInfo,
  effectivePermission,
  type Capability,
  type CapabilityInfo,
  type CapabilitySelection,
} from "./capabilities";
import { acquireStoreLock, type StoreLock } from "./lock";
import { createGatewayModels, GATEWAY_PROVIDER, toModelInfo } from "./models";
import {
  checkAnswers,
  createQuestionsCapability,
  InvalidAnswersError,
  QuestionsDoc,
  storedQuestions,
} from "./toolkits/questions";
import { REPORT_ROUTINE_BLOCKED } from "./toolkits/routines";
import {
  attachmentsOf,
  chatState,
  diffChat,
  CHAT_USER_ENTRY,
  type LiveTool,
  pageBefore,
  queuedOf,
  type RawChat,
  windowChat,
} from "./transcript";
import type {
  ActivityChange,
  AttachmentRef,
  BotAgentConfig,
  ChatEvent,
  ChatMessage,
  ChatPage,
  ChatState,
  ChatSubscription,
  ChatToolCall,
  ConversationRef,
  FinishedReply,
  LastMessage,
  ModelInfo,
  OwnerAnswer,
  QueuedMessage,
  WaitEvent,
  WithdrawOutcome,
} from "./types";
import { WaitTracker } from "./waiting";
import { REVIEW_ENTRY_LOOKBACK, type GateReview, type Reviewer } from "./reviewer";

const ctx: Context = BACKGROUND_CONTEXT;

/** Entries read per storage page when loading a chat's history. */
const HISTORY_PAGE = 500;

/** Task kinds that mean "the bot is replying" (background compaction does not). */
const REPLY_TASK_KINDS = new Set(["pi.generation", "pi.tool"]);

export class ModelNotFoundError extends Error {
  constructor(modelId: string) {
    super(`Unknown model "${modelId}"`);
    this.name = "ModelNotFoundError";
  }
}

export class ConversationNotFoundError extends Error {
  constructor(ref: ConversationRef) {
    super(`Conversation ${ref} not found`);
    this.name = "ConversationNotFoundError";
  }
}

/** The approval was already answered, or its tool call ended. */
export class ApprovalNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for approval`);
    this.name = "ApprovalNotPendingError";
  }
}

/** The credential request was already answered, expired, or its call ended. */
export class CredentialRequestNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for credentials`);
    this.name = "CredentialRequestNotPendingError";
  }
}

/** The questions were already answered or dismissed, or their call ended. */
export class QuestionNotPendingError extends Error {
  constructor(taskId: number) {
    super(`Tool call ${taskId} is not waiting for answers`);
    this.name = "QuestionNotPendingError";
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
  /**
   * Capabilities bots can be given (toolkits, skills, connections). Installed
   * behind the approval gate; selected per conversation by `configure()`.
   */
  capabilities?: readonly Capability[];
  /**
   * Counts calls waiting on the owner's approval. Pass one when a capability
   * waits on the owner itself (credential requests), so they count as approvals.
   */
  approvalTracker?: WaitTracker;
  /**
   * Auto-review (issue #65): judges calls that would ask the owner, for
   * conversations whose capabilities turn it on. Without one, every such
   * call shows its approval card.
   */
  reviewer?: Reviewer;
  /** Raw extensions installed as-is (tests). Selected by conversations that never chose capabilities. */
  extensions?: readonly Extension[];
  /** Non-fatal errors pi-durable reports (hooks, listeners, …). */
  onReport?: (error: unknown) => void;
  /** The Harness failed (storage error) and closed itself. The host should exit/restart. */
  onFatal?: (error: unknown) => void;
  /** Env snapshot override (tests/faux boot). Defaults to process.env. */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * The single owner of pi-durable in tiny-agents (PRD §7.2). One instance per
 * process, opened at boot before the HTTP server accepts requests.
 */
/** Parse GATEWAY_MODEL_ALLOWLIST (comma-separated ids) into a set, or null. */
function modelAllowlist(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Set<string> | null {
  // Tolerate the whole value being quote-wrapped by container env UIs
  // (Coolify editors keep literal quotes); individual ids are trimmed.
  const raw = env.GATEWAY_MODEL_ALLOWLIST?.trim()
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim();
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

export class AgentRuntime {
  readonly provider: string;
  readonly #harness: Harness;
  readonly #models: MutableModels;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #lock: StoreLock | undefined;
  readonly #chats = new Set<ChatSubscription>();
  readonly #activityListeners = new Set<(change: ActivityChange) => void>();
  readonly #registry: Registry;
  readonly #approvals: WaitTracker;
  readonly #questions: WaitTracker;
  readonly #capabilities = new Map<string, Capability>();
  #review: GateReview | undefined;
  #busy = new Set<ConversationRef>();
  #graph: TaskGraphWatch | undefined;
  #closed = false;

  /** The model registry this runtime runs with (built or passed at open). */
  get models(): MutableModels {
    return this.#models;
  }

  private constructor(
    harness: Harness,
    models: MutableModels,
    provider: string,
    lock: StoreLock | undefined,
    registry: Registry,
    approvals: WaitTracker,
    questions: WaitTracker,
    capabilities: readonly Capability[],
    envSource: Readonly<Record<string, string | undefined>> = process.env,
  ) {
    this.#harness = harness;
    this.#models = models;
    this.provider = provider;
    this.#lock = lock;
    this.#registry = registry;
    this.#approvals = approvals;
    this.#questions = questions;
    for (const capability of capabilities) this.#capabilities.set(capability.id, capability);
    this.#env = { ...envSource };
    approvals.onChange((conversation) => this.#emitActivity(this.#activity(conversation)));
    questions.onChange((conversation) => this.#emitActivity(this.#activity(conversation)));
  }

  /**
   * Lock the store, open the Harness and resume interrupted work. Throws
   * `StoreLockedError` when another process owns the store.
   */
  static async open(options: AgentRuntimeOptions): Promise<AgentRuntime> {
    // Snapshot ambient env NOW: varlock's auto-load (imported via
    // @groot/core/env) later strips schema vars from process.env, so reading
    // them lazily would see undefined. Callers that swap the provider (faux
    // boot, tests) pass their own snapshot, e.g. without GATEWAY_MODEL_ALLOWLIST.
    const envSource: Readonly<Record<string, string | undefined>> = options.env
      ? { ...options.env }
      : { ...process.env };
    const inMemory = options.storePath === ":memory:";
    const lock = inMemory
      ? undefined
      : acquireStoreLock(options.storePath, { waitMs: options.lockWaitMs });
    let storage: Storage | undefined;
    let harness: Harness | undefined;
    let runtime: AgentRuntime | undefined;
    try {
      storage = inMemory ? new MemoryStorage() : await openNodeSqliteStorage(options.storePath);
      const models = options.models ?? createGatewayModels(envSource);
      const registry = createRegistry();
      const approvals = options.approvalTracker ?? new WaitTracker();
      const questions = new WaitTracker();
      // Questions for the owner wait on a document this runtime answers, so
      // the runtime brings their capability; conversations select it by id.
      const capabilities = [...(options.capabilities ?? []), createQuestionsCapability(questions)];
      for (const extension of options.extensions ?? []) registry.install(extension);
      // Capabilities must be installed before resume(): interrupted calls of
      // their tools (e.g. a pending approval or question) re-run against them.
      // Auto-review reads the owner's messages through the Harness opened below.
      const review: GateReview | undefined = options.reviewer
        ? {
            reviewer: options.reviewer,
            recentEntries: async (id) => {
              const conversation = await harness?.conversation(id as ConversationId, ctx);
              if (!conversation) return [];
              const page = await conversation.entries(
                { order: "descending" },
                REVIEW_ENTRY_LOOKBACK,
                undefined,
                ctx,
              );
              return page.items;
            },
          }
        : undefined;
      for (const capability of capabilities) {
        registry.install(gateExtension(capability.extension, approvals, review));
      }
      harness = await Harness.open(
        storage,
        {
          models,
          registry,
          settings: { compaction: { enabled: true }, ...options.settings },
          onReport: options.onReport,
        },
        ctx,
      );
      const opened = new AgentRuntime(
        harness,
        models,
        options.provider ?? GATEWAY_PROVIDER,
        lock,
        registry,
        approvals,
        questions,
        capabilities,
        envSource,
      );
      opened.#review = review;
      runtime = opened;
      harness.closed.then((end) => {
        if (end.reason === "failed" && !opened.#closed) options.onFatal?.(end.error);
      });
      await opened.#watchActivity();
      harness.resume();
      return opened;
    } catch (error) {
      // A failed open is reported by this rejection, not also via onFatal.
      if (runtime) runtime.#closed = true;
      // Release what was opened: the Harness owns (and closes) the storage
      // once open; before that the storage handle is ours to close.
      await (harness ? harness.close(ctx) : storage?.close(ctx))?.catch(() => undefined);
      lock?.release();
      throw error;
    }
  }

  // ── Models ────────────────────────────────────────────────────────────

  listModels(): ModelInfo[] {
    // Catalog models plus any registered gateway custom providers (their ids
    // are namespaced "custom-<provider>/<model>" so bots' saved modelIds
    // stay stable and never collide with catalog ids).
    const catalog = this.#models.getModels(this.provider).map((m) => toModelInfo(m));
    const custom = this.#models
      .getProviders()
      .filter((p) => p.id !== this.provider)
      .flatMap((p) =>
        this.#models.getModels(p.id).map((model) => toModelInfo(model, `custom:${p.id}`)),
      );
    const all = [...catalog, ...custom];
    const allow = modelAllowlist(this.#env);
    return allow ? all.filter((m) => allow.has(m.id)) : all;
  }

  hasModel(modelId: string): boolean {
    return this.#resolveModel(modelId) !== undefined;
  }

  /**
   * Resolve a model id to (provider, model). Catalog ids are plain; gateway
   * custom providers use "custom:<provider>/<model>" (the slash inside the
   * provider segment is forbidden by registration, so the first "/" splits).
   */
  #resolveModel(modelId: string): { provider: string; model: string } | undefined {
    if (modelId.startsWith("custom:")) {
      const rest = modelId.slice("custom:".length);
      const slash = rest.indexOf("/");
      if (slash <= 0) return undefined;
      const providerId = rest.slice(0, slash);
      const model = rest.slice(slash + 1);
      return this.#models.getModel(providerId, model) ? { provider: providerId, model } : undefined;
    }
    return this.#models.getModel(this.provider, modelId)
      ? { provider: this.provider, model: modelId }
      : undefined;
  }

  // ── Conversations ─────────────────────────────────────────────────────

  async createConversation(config: BotAgentConfig): Promise<ConversationRef> {
    const change = this.#agentChange(config);
    const conversation = await this.#harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: change },
      ctx,
    );
    const ref = Number(conversation.id);
    if (config.capabilities) await this.#writePermissions(ref, config.capabilities);
    return ref;
  }

  /**
   * Change persona, model and capabilities. Applies from the next model
   * request; history is kept.
   */
  async configure(ref: ConversationRef, config: BotAgentConfig): Promise<void> {
    const change = this.#agentChange(config);
    await this.#conversation(ref);
    await this.#harness.commit(async (tx) => {
      await configureAgent(tx, ref as ConversationId, change);
      if (config.capabilities) {
        this.#setPermissions(
          await tx.doc(PermissionsDoc, ref as ConversationId),
          config.capabilities,
        );
      }
    }, ctx);
  }

  #agentChange(config: BotAgentConfig): AgentChange {
    const resolved = this.#resolveModel(config.modelId);
    if (!resolved) throw new ModelNotFoundError(config.modelId);
    const change: AgentChange = {
      model: { provider: resolved.provider, modelId: resolved.model },
      instructions: config.systemPrompt.trim() ? config.systemPrompt : null,
    };
    if (!config.capabilities) return change;
    const selected = this.#selected(config.capabilities);
    const installed = this.#registry.snapshot();
    const off: ToolRegistration[] = [];
    for (const capability of selected) {
      for (const tool of capability.tools) {
        const offHere = tool.unattendedOnly === true && !config.capabilities.unattended;
        if (!offHere && effectivePermission(tool, config.capabilities.permissions) !== "off") {
          continue;
        }
        const registration = installed
          .extension(capability.id)
          ?.tools?.find((candidate) => candidate.name === tool.name);
        if (registration) off.push(registration);
      }
    }
    return {
      ...change,
      // pi-durable stores names: a capability installed later (an MCP server
      // reconnecting) is picked up by name without reconfiguring.
      extensions: selected
        .map((capability) => installed.extension(capability.id))
        .filter((extension): extension is Extension => extension !== undefined),
      tools: { remove: off },
    };
  }

  #selected(selection: CapabilitySelection): Capability[] {
    return selection.enabled
      .map((id) => this.#capabilities.get(id))
      .filter((capability): capability is Capability => capability !== undefined);
  }

  #allowedTools(selection: CapabilitySelection): string[] {
    return this.#selected(selection).flatMap((capability) =>
      capability.tools
        .filter((tool) => effectivePermission(tool, selection.permissions) === "allow")
        .map((tool) => tool.name),
    );
  }

  /** Tools that would ask and auto-review may approve (never `askOnly` ones). */
  #reviewableTools(selection: CapabilitySelection): string[] {
    if (!selection.autoReview) return [];
    return this.#selected(selection).flatMap((capability) =>
      capability.tools
        .filter(
          (tool) => !tool.askOnly && effectivePermission(tool, selection.permissions) === "ask",
        )
        .map((tool) => tool.name),
    );
  }

  #setPermissions(
    doc: { allow: string[]; review?: string[]; unattended?: boolean },
    selection: CapabilitySelection,
  ): void {
    doc.allow = this.#allowedTools(selection);
    const review = selection.unattended ? [] : this.#reviewableTools(selection);
    if (review.length > 0) doc.review = review;
    else delete doc.review;
    if (selection.unattended) doc.unattended = true;
    else delete doc.unattended;
  }

  async #writePermissions(ref: ConversationRef, selection: CapabilitySelection): Promise<void> {
    await this.#harness.commit(async (tx) => {
      this.#setPermissions(await tx.doc(PermissionsDoc, ref as ConversationId), selection);
    }, ctx);
  }

  // ── Capabilities ──────────────────────────────────────────────────────

  listCapabilities(): CapabilityInfo[] {
    return [...this.#capabilities.values()].map(capabilityInfo);
  }

  /**
   * Install or replace a capability while running (an MCP connection that
   * (re)connected or changed its tools). Conversations select it by name, so
   * bots that enabled it pick it up from their next model request.
   */
  installCapability(capability: Capability): void {
    this.#capabilities.set(capability.id, capability);
    this.#registry.install(gateExtension(capability.extension, this.#approvals, this.#review));
  }

  /** Withdraw a capability (connection removed or signed out). Bots keep it selected by name. */
  uninstallCapability(id: string): void {
    const extension = this.#registry.snapshot().extension(id);
    this.#capabilities.delete(id);
    if (extension) this.#registry.uninstall(extension);
  }

  // ── Approvals ─────────────────────────────────────────────────────────

  /** Tool calls of the conversation waiting for the owner's approval. */
  pendingApprovals(ref: ConversationRef): number {
    return this.#approvals.count(ref);
  }

  /**
   * Upload ids attached to the conversation's recent sends (issue #17):
   * what see_image may read. Bounded to the newest 50 user entries; a bot
   * referencing an attachment older than that gets the not-found result.
   */
  async attachmentIds(ref: ConversationRef): Promise<string[]> {
    const conversation = await this.#conversation(ref);
    const page = await conversation.entries({ order: "descending" }, 50, undefined, ctx);
    const ids: string[] = [];
    for (const entry of page.items) {
      for (const attachment of attachmentsOf(entry) ?? []) {
        if (!ids.includes(attachment.uploadId)) ids.push(attachment.uploadId);
      }
    }
    return ids;
  }

  /**
   * Answer a gated tool call (`taskId` from the chat's tool call). With
   * `grant`, an approval also records the standing grant the card offered
   * (a vault handle for the rest of the conversation). Throws
   * `ApprovalNotPendingError` when it was already answered or has ended.
   */
  async decideApproval(
    ref: ConversationRef,
    taskId: number,
    decision: ApprovalDecision,
    options: { grant?: boolean } = {},
  ): Promise<void> {
    const id = taskId as TaskId;
    try {
      await this.#harness.commit(async (tx) => {
        await this.#pendingTask(tx, ref, id, () => new ApprovalNotPendingError(taskId));
        const doc = await tx.doc(ApprovalDoc, id);
        if (doc.status !== "pending") throw new ApprovalNotPendingError(taskId);
        doc.status = decision;
        if (decision === "approved" && options.grant && doc.grant) {
          const grants = await tx.doc(GrantsDoc, ref as ConversationId);
          if (!grants.grants.includes(doc.grant)) grants.grants.push(doc.grant);
        }
      }, ctx);
    } catch (error) {
      if (error instanceof ApprovalNotPendingError) throw error;
      // A terminal task's documents are sealed: the call already ended.
      if (error instanceof Error && /terminal/i.test(error.message)) {
        throw new ApprovalNotPendingError(taskId);
      }
      throw error;
    }
  }

  async #pendingTask(
    tx: Parameters<Parameters<Harness["commit"]>[0]>[0],
    ref: ConversationRef | undefined,
    id: TaskId,
    notPending: () => Error,
  ): Promise<ConversationRef> {
    const task = await tx.task(id);
    if (
      !task ||
      (ref !== undefined && Number(task.conversationId) !== ref) ||
      task.kind !== "pi.tool" ||
      task.state.status === "terminal" ||
      task.state.status === "completing"
    ) {
      throw notPending();
    }
    return Number(task.conversationId);
  }

  // ── Credential requests ───────────────────────────────────────────────

  /**
   * A `request_credentials` call still waiting for the owner, with its
   * conversation. Throws `CredentialRequestNotPendingError` otherwise.
   */
  async credentialRequest(
    taskId: number,
  ): Promise<{ conversation: ConversationRef; request: CredentialRequest; expiresAt: number }> {
    const id = taskId as TaskId;
    const notPending = () => new CredentialRequestNotPendingError(taskId);
    try {
      return await this.#harness.commit(async (tx) => {
        const conversation = await this.#pendingTask(tx, undefined, id, notPending);
        // Another tool's task has no request (and the throw rolls back the
        // document this read would create).
        const doc = await tx.doc(CredentialRequestDoc, id);
        if (doc.status !== "pending" || !doc.request) throw notPending();
        if (doc.expiresAt <= Date.now()) throw notPending();
        return {
          conversation,
          // A plain copy: the draft is a proxy that structuredClone can't copy.
          request: JSON.parse(JSON.stringify(storedRequest(doc))) as CredentialRequest,
          expiresAt: doc.expiresAt,
        };
      }, ctx);
    } catch (error) {
      if (error instanceof Error && /terminal/i.test(error.message)) throw notPending();
      throw error;
    }
  }

  /** Settle a credential request with the owner's outcome (never values). */
  async settleCredentialRequest(taskId: number, outcome: CredentialRequestOutcome): Promise<void> {
    const id = taskId as TaskId;
    const notPending = () => new CredentialRequestNotPendingError(taskId);
    try {
      await this.#harness.commit(async (tx) => {
        await this.#pendingTask(tx, undefined, id, notPending);
        const doc = await tx.doc(CredentialRequestDoc, id);
        if (doc.status !== "pending" || !doc.request) throw notPending();
        doc.status = outcome.status;
        if (outcome.status === "filled") {
          doc.filled = [...outcome.filled];
          doc.savedHandle = outcome.savedHandle ?? null;
        }
      }, ctx);
    } catch (error) {
      if (error instanceof Error && /terminal/i.test(error.message)) throw notPending();
      throw error;
    }
  }

  /** `ask_owner` calls of the conversation waiting for the owner's answers. */
  pendingQuestions(ref: ConversationRef): number {
    return this.#questions.count(ref);
  }

  /**
   * Answer an `ask_owner` call (`taskId` from the chat's tool call), one
   * answer per question, or dismiss its questions with `null`. Throws
   * `QuestionNotPendingError` when it was already answered or has ended, and
   * `InvalidAnswersError` when the answers do not fit the questions.
   */
  async answerQuestions(
    ref: ConversationRef,
    taskId: number,
    answers: OwnerAnswer[] | null,
  ): Promise<void> {
    const id = taskId as TaskId;
    try {
      await this.#harness.commit(async (tx) => {
        const task = await tx.task(id);
        if (
          !task ||
          Number(task.conversationId) !== ref ||
          task.kind !== "pi.tool" ||
          task.state.status === "terminal" ||
          task.state.status === "completing"
        ) {
          throw new QuestionNotPendingError(taskId);
        }
        // Another tool's task has no questions (and the throw rolls back the
        // document this read would create).
        const doc = await tx.doc(QuestionsDoc, id);
        if (doc.status !== "pending" || doc.questions.length === 0) {
          throw new QuestionNotPendingError(taskId);
        }
        if (answers) {
          doc.answers = checkAnswers(storedQuestions(doc), answers) as unknown as JsonValue[];
          doc.status = "answered";
        } else {
          doc.status = "dismissed";
        }
      }, ctx);
    } catch (error) {
      if (error instanceof QuestionNotPendingError || error instanceof InvalidAnswersError) {
        throw error;
      }
      // A terminal task's documents are sealed: the call already ended.
      if (error instanceof Error && /terminal/i.test(error.message)) {
        throw new QuestionNotPendingError(taskId);
      }
      throw error;
    }
  }

  /** Dismiss every question of the conversation still waiting (the owner wrote in the chat instead). */
  async dismissQuestions(ref: ConversationRef): Promise<void> {
    for (const taskId of this.#questions.tasks(ref)) {
      try {
        await this.answerQuestions(ref, taskId, null);
      } catch (error) {
        // Answered or ended meanwhile: nothing left to dismiss.
        if (!(error instanceof QuestionNotPendingError)) throw error;
      }
    }
  }

  /**
   * Durably admit a user message. Retrying with the same `requestId` never
   * submits twice. While a reply is running, the message is queued: a steer
   * (`whenBusy: "steer"`) joins the reply after its current tool round; the
   * default follow-up is answered by the next run.
   */
  async submit(
    ref: ConversationRef,
    input: {
      requestId: string;
      /** Plain text, or text plus inline image blocks. */
      text: string;
      images?: { data: string; mimeType: string }[];
      /** Attachment refs stored on the entry for the transcript (issue #17). */
      attachments?: AttachmentRef[];
      /** Trusted attribution for a cross-bot delivery (rendered as a card). */
      peer?: ChatMessage["peer"];
      /** Placement while a reply runs: "steer" joins it, "followUp" (default) waits. */
      whenBusy?: "steer" | "followUp";
    },
  ): Promise<void> {
    const conversation = await this.#conversation(ref);
    const content = input.images?.length
      ? [
          ...(input.text ? [{ type: "text" as const, text: input.text }] : []),
          ...input.images.map((image) => ({
            type: "image" as const,
            data: image.data,
            mimeType: image.mimeType,
          })),
        ]
      : input.text;
    await conversation.submit(
      {
        type: "input",
        content,
        requestId: input.requestId,
        ...(input.whenBusy ? { whenBusy: input.whenBusy } : {}),
        ...(input.attachments?.length || input.peer
          ? {
              entry: {
                kind: CHAT_USER_ENTRY,
                data: {
                  requestId: input.requestId,
                  ...(input.peer ? { peer: input.peer } : {}),
                  ...(input.attachments?.length
                    ? {
                        attachments: input.attachments.map((a) => ({
                          uploadId: a.uploadId,
                          kind: a.kind,
                          name: a.name,
                          mimeType: a.mimeType,
                          size: a.size,
                          ...(a.width !== undefined ? { width: a.width } : {}),
                          ...(a.height !== undefined ? { height: a.height } : {}),
                        })),
                      }
                    : {}),
                } as unknown as JsonValue,
              },
            }
          : {}),
      },
      ctx,
    );
  }

  /** Stop the in-flight reply (and withdraw queued inputs). */
  async abort(ref: ConversationRef): Promise<void> {
    const conversation = await this.#conversation(ref);
    await conversation.abort(ctx);
  }

  /**
   * Withdraw a message by its request id. A queued input leaves the inbox
   * (settling `unanswered`, reason `aborted`); a placed one is already part
   * of the running reply, and a settled one is done.
   */
  async withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    const record = await this.#harness.commit(
      (tx) => tx.submissionByRequest(ref as ConversationId, requestId),
      ctx,
    );
    // Writes (compaction summaries) and unknown ids are not owner messages.
    if (!record || record.type !== "input") return "not_found";
    if (record.status === "queued") {
      const result = await this.#harness.abortSubmission(record.id, ctx, ref as ConversationId);
      if (result === "aborted") return "withdrawn";
      return result;
    }
    if (record.status === "placed") return "already_placed";
    // An input already withdrawn (by cancel or Stop) stays withdrawn, not 409.
    if (record.status === "unanswered" && record.reason === "aborted") return "withdrawn";
    return "settled";
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
   * The conversation's finished assistant replies, oldest first. Empty while
   * a reply is running: one still streaming (or paused between tool rounds)
   * is not finished, and the caller's next idle reads it whole. A reply that
   * ended in a model error carries `error`; replies with neither text nor an
   * error (tool-call rounds) are left out.
   */
  async finishedReplies(ref: ConversationRef): Promise<FinishedReply[]> {
    const state = await this.readChat(ref);
    if (state.busy) return [];
    const replies: FinishedReply[] = [];
    for (const message of state.messages) {
      if (message.role !== "assistant" || message.status === "streaming") continue;
      const error = message.status === "error" ? message.error : undefined;
      const refused = message.toolCalls
        ?.filter((call) => call.approval === "refused")
        .map((call) => call.name);
      const blocked = blockedReason(message.toolCalls);
      if (!message.text && error === undefined && !refused?.length && blocked === undefined) {
        continue;
      }
      replies.push({
        text: message.text,
        createdAt: message.createdAt,
        ...(error !== undefined ? { error } : {}),
        ...(refused?.length ? { refused } : {}),
        ...(blocked !== undefined ? { blocked } : {}),
      });
    }
    return replies;
  }

  /**
   * The conversation's chat state right now: the same snapshot `watchChat`
   * delivers first, for one-shot readers (relay, routines, memory capture)
   * that need the transcript but no stream.
   */
  async readChat(ref: ConversationRef): Promise<ChatState> {
    const subscription = await this.watchChat(ref, () => undefined);
    await subscription.stop();
    return subscription.initial;
  }

  /**
   * Up to `limit` messages just before message `before`, oldest first: the
   * history above a windowed stream's snapshot. Undefined when `before` is
   * not (or no longer) in the transcript.
   */
  async readChatPage(
    ref: ConversationRef,
    { before, limit }: { before: string; limit: number },
  ): Promise<ChatPage | undefined> {
    return pageBefore((await this.readChat(ref)).messages, before, limit);
  }

  /**
   * Watch a conversation as chat events: a `snapshot` first, then minimal
   * upserts/deltas per commit. Reconnecting clients simply watch again.
   *
   * With `window`, snapshots carry only the newest `window` messages plus
   * `hasMore`/`cursor` (issue #92). The window's start then stays put, so
   * new messages arrive as upserts and nothing drops out of it; a
   * re-snapshot (a slow client fell behind) re-windows to the newest ones.
   */
  async watchChat(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number } = {},
  ): Promise<ChatSubscription> {
    const conversation = await this.#conversation(ref);
    const stream = await watchEvents(this.#harness, ref as ConversationId, ctx);

    const raw: MutableRaw = {
      entries: new Map(),
      live: stream.snapshot.generation?.message
        ? structuredClone(stream.snapshot.generation.message)
        : undefined,
      busy: stream.snapshot.run !== undefined,
      unanswered: new Map(),
      tools: liveTools(stream.snapshot.tools),
      queued: [],
    };
    for (const entry of await loadHistory(conversation)) raw.entries.set(Number(entry.id), entry);
    for (const entry of stream.snapshot.entries) raw.entries.set(Number(entry.id), entry);
    // Seed the queue from the inbox doc (read after the snapshot, so it is at
    // least as new): a reload shows what a busy conversation is still holding.
    await this.#refreshQueued(raw, ref);

    const view = (): RawChat => ({
      entries: [...raw.entries.values()],
      live: raw.live,
      busy: raw.busy,
      unanswered: raw.unanswered,
      tools: raw.tools,
      queued: raw.queued,
    });

    // The window's first message id, fixed once older messages exist; with
    // none, the window is the whole transcript and grows from its start.
    let from: string | undefined;
    /** `full` as this stream shows it; undefined when `from` is gone. */
    const windowed = (full: ChatState, fresh: boolean): ChatState | undefined => {
      if (options.window === undefined) return full;
      const next = fresh
        ? windowChat(full, options.window)
        : windowChat(full, Number.POSITIVE_INFINITY, from);
      if (next) from = next.hasMore ? next.cursor : undefined;
      return next;
    };

    let state: ChatState = windowed(chatState(view()), true)!;
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
      let inboxChanged = false;
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
          raw.tools = liveTools(event.tools);
          continue;
        }
        // The inbox doc moved (send while busy, placement, withdrawal); the
        // items' content lives in the doc, not the event.
        if (event.type === "inbox_update") {
          inboxChanged = true;
          continue;
        }
        applyEvent(raw, event);
      }
      if (resnapshot || inboxChanged) await this.#refreshQueued(raw, ref);
      const full = chatState(view());
      // The window's first message vanished (never expected): start afresh.
      const kept = resnapshot ? undefined : windowed(full, false);
      if (!kept) resnapshot = true;
      const next = kept ?? windowed(full, true)!;
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

  /**
   * Each tool call that starts or stops waiting on the owner: approvals and
   * questions. A call re-run after a restart is reported as added again.
   */
  onWait(listener: (event: WaitEvent) => void): () => void {
    const offApprovals = this.#approvals.onTransition((t) => listener({ kind: "approval", ...t }));
    const offQuestions = this.#questions.onTransition((t) => listener({ kind: "question", ...t }));
    return () => {
      offApprovals();
      offQuestions();
    };
  }

  async #watchActivity(): Promise<void> {
    const graph = await this.#harness.watchTaskGraph(ctx);
    this.#graph = graph;
    this.#busy = busyFromGraph(graph.value);
    graph.start(async (value) => {
      const next = busyFromGraph(value);
      const changed: ConversationRef[] = [];
      for (const ref of next) if (!this.#busy.has(ref)) changed.push(ref);
      for (const ref of this.#busy) if (!next.has(ref)) changed.push(ref);
      this.#busy = next;
      for (const ref of changed) this.#emitActivity(this.#activity(ref));
    });
  }

  #activity(ref: ConversationRef): ActivityChange {
    return {
      conversation: ref,
      busy: this.#busy.has(ref),
      approvals: this.#approvals.count(ref),
      questions: this.#questions.count(ref),
    };
  }

  #emitActivity(change: ActivityChange): void {
    for (const listener of this.#activityListeners) {
      try {
        listener(change);
      } catch {
        // listeners must not break the activity feed
      }
    }
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

  /**
   * Read the conversation's queued owner messages from `pi.inbox`. The inbox
   * doc holds the items; the submission records (via `inspect()`) supply the
   * request ids withdrawal addresses. Both reads are plain snapshots, newer
   * than any event that triggered the refresh.
   */
  async #refreshQueued(raw: MutableRaw, ref: ConversationRef): Promise<void> {
    const inbox = await this.#harness.snapshot(InboxDoc, ref as ConversationId, ctx);
    const items = inbox?.items ?? [];
    if (items.length === 0) {
      raw.queued = [];
      return;
    }
    const inspection = await this.#harness.inspect(ctx);
    const records = new Map(
      inspection.submissions
        .filter((record) => Number(record.conversationId) === ref)
        .map((record) => [String(record.id), record]),
    );
    raw.queued = queuedOf(items, records);
  }

  async #conversation(ref: ConversationRef): Promise<Conversation> {
    const conversation = await this.#harness.conversation(ref as ConversationId, ctx);
    if (!conversation) throw new ConversationNotFoundError(ref);
    return conversation;
  }
}

/** The reason a message's finished `report_routine_blocked` call gave, if it made one (issue #87). */
function blockedReason(calls: ChatToolCall[] | undefined): string | undefined {
  const call = calls?.findLast(
    (candidate) => candidate.name === REPORT_ROUTINE_BLOCKED && candidate.status === "done",
  );
  const reason = call?.args.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
}

function busyFromGraph(value: TaskGraphWatch["value"]): Set<ConversationRef> {
  const busy = new Set<ConversationRef>();
  for (const node of Object.values(value.tasks)) {
    if (REPLY_TASK_KINDS.has(node.kind)) busy.add(Number(node.conversationId));
  }
  return busy;
}

/**
 * Every stored entry of a conversation, ascending — the full transcript, not
 * just what the model still sees after resets/compactions. Paged so a long
 * conversation never loads in one storage read.
 */
async function loadHistory(conversation: Conversation): Promise<EntryRecord[]> {
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await conversation.entries({ order: "ascending" }, HISTORY_PAGE, cursor, ctx);
    entries.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  return entries;
}

type MutableRaw = {
  entries: Map<number, EntryRecord>;
  live?: AssistantMessage;
  busy: boolean;
  unanswered: Map<number, string>;
  tools: Map<string, LiveTool>;
  queued: QueuedMessage[];
};

/** Model-issued calls of the current round (nested calls live in `nestedTools`). */
function liveTools(slots: readonly ToolSlot[]): Map<string, LiveTool> {
  const tools = new Map<string, LiveTool>();
  for (const slot of slots) {
    tools.set(slot.callId, {
      status: slot.status,
      ...(slot.taskId !== undefined ? { taskId: Number(slot.taskId) } : {}),
      ...(slot.output ? { output: slot.output } : {}),
      ...(slot.details !== undefined ? { details: slot.details } : {}),
    });
  }
  return tools;
}

function applyEvent(raw: MutableRaw, event: AgentEvent): void {
  switch (event.type) {
    case "tool_execution_start":
      if (event.parentToolCallId === undefined) {
        raw.tools.set(event.toolCallId, {
          status: "running",
          ...(event.taskId !== undefined ? { taskId: Number(event.taskId) } : {}),
        });
      }
      break;
    case "tool_execution_update": {
      const slot = raw.tools.get(event.toolCallId);
      if (!slot || event.parentToolCallId !== undefined) break;
      const next: LiveTool = { ...slot };
      if (event.details !== undefined) next.details = event.details ?? undefined;
      if (event.output) {
        next.output =
          "set" in event.output
            ? event.output.set
            : (slot.output ?? "").slice(event.output.trimStart ?? 0) + (event.output.append ?? "");
      }
      raw.tools.set(event.toolCallId, next);
      break;
    }
    case "tool_execution_end":
      if (event.parentToolCallId !== undefined) break;
      raw.tools.delete(event.toolCallId);
      if (event.entry) raw.entries.set(Number(event.entry.id), event.entry);
      break;
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
      raw.tools.clear();
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
