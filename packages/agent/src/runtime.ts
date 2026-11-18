import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, type MutableModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  Harness,
  type Extension,
  MemoryStorage,
  type AgentChange,
  type ConversationId,
  type HarnessSettings,
  type Registry,
  type Storage,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  ApprovalNotPendingError,
  approvalNotPending,
  recordDecision,
  recordYoloDecision,
  type ApprovalDecision,
} from "./approvals";
import {
  CredentialRequestNotPendingError,
  credentialRequestNotPending,
  readPendingRequest,
  settleRequest,
  type CredentialRequest,
  type CredentialRequestOutcome,
} from "./credentials";
import {
  capabilityInfo,
  createToolSearchCapability,
  type Capability,
  type CapabilityInfo,
} from "./capabilities";
import { withContextCeiling } from "./context-ceiling";
import { createContextTrimExtension } from "./context-trim";
import { acquireStoreLock, type StoreLock } from "./lock";
import {
  buildProviders,
  createModelCatalog,
  EMPTY_MODEL_CONFIG,
  type CredentialResolver,
  type ModelCatalog,
  type ModelConfig,
  type ModelUnavailableReason,
} from "@tiny-agents/models";
import { gateExtension, PiEngine } from "./engines/pi";
import { ConversationStore } from "./conversation-store";
import type { AgentEngine, CompiledConversation, EngineSubmission } from "./engine";
import type { WebSocketLike } from "./engines/claude-code/client";
import { ClaudeCodeEngine } from "./engines/claude-code/engine";
import { ClaudePlan, claudePlanState } from "./engines/claude-code/plan";
import type { ClaudeWorkerLocator } from "./engines/claude-code/sandbox-worker";
import { claudeToolSurface } from "./engines/claude-code/tools";
import { ToolGate } from "./gate";
import { compilePolicy } from "./policy";
import {
  createQuestionsCapability,
  QuestionNotPendingError,
  questionNotPending,
  recordAnswers,
} from "./toolkits/questions";
import { finishedReplyOf } from "./replies";
import { lastMessageOf, pageBefore } from "./transcript";
import type {
  ActivityChange,
  BotAgentConfig,
  ChatEvent,
  ChatPage,
  ChatState,
  ChatSubscription,
  ConversationRef,
  FinishedReply,
  LastMessage,
  OwnerAnswer,
  WaitEvent,
  WithdrawOutcome,
} from "./types";
import { WaitTracker } from "./waiting";
import type { Reviewer } from "./reviewer";
import { GrantsDoc } from "./vault";
import type { ConversationTrace, ConversationUsage } from "./trace";

// The three wait kinds own their not-pending errors; the app imports them from here.
export { ApprovalNotPendingError, CredentialRequestNotPendingError, QuestionNotPendingError };

const ctx: Context = BACKGROUND_CONTEXT;

/** A bot's model can't run: unknown, or its account is disabled, locked or failing. */
export class ModelUnavailableError extends Error {
  constructor(
    readonly modelId: string,
    readonly reason: ModelUnavailableReason,
  ) {
    super(
      reason === "missing"
        ? `Model "${modelId}" is not set up. Pick another in the bot's settings.`
        : `Model "${modelId}" can't run right now (${reason}). Check Settings → Models.`,
    );
    this.name = "ModelUnavailableError";
  }
}

const noCredentials: CredentialResolver = { resolve: async () => undefined };

export interface AgentRuntimeOptions {
  /** Path of the pi-durable SQLite store, or ":memory:" (tests). */
  storePath: string;
  /**
   * The owner's provider accounts, model rows and roles (issue #179). The
   * runtime registers a pi-ai provider per account; `applyModelConfig`
   * replaces it while running. Default: none.
   */
  modelConfig?: ModelConfig;
  /** Resolves an account's key per request (the app's vault). */
  credentials?: CredentialResolver;
  /**
   * A registry with providers the host built itself (the faux provider in
   * tests and dev). The runtime adds the accounts' providers to it and never
   * touches the others.
   */
  models?: MutableModels;
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
  /**
   * The owner's user id, for auto-review in a shared chat: it reads only the
   * owner's messages (S6). Without one, no message with an author counts.
   */
  ownerUserId?: () => Promise<number | undefined>;
  /** Raw extensions installed as-is (tests). Selected by conversations that never chose capabilities. */
  extensions?: readonly Extension[];
  /** Non-fatal errors pi-durable reports (hooks, listeners, …). */
  onReport?: (error: unknown) => void;
  /** The Harness failed (storage error) and closed itself. The host should exit/restart. */
  onFatal?: (error: unknown) => void;
  /**
   * Where Claude plan turns run: the sandbox worker the app sets up over SSH.
   */
  claudeWorker?: ClaudeWorkerLocator;
  /** Tests: open a fake worker socket instead of a WebSocket to the sandbox worker. */
  claudeConnect?: (url: string, token: string) => WebSocketLike;
}

/**
 * The single owner of pi-durable in tiny-agents (PRD §7.2). One instance per
 * process, opened at boot before the HTTP server accepts requests.
 *
 * It owns the conversation store (the pi-durable harness, and every
 * conversation's agent, documents and reply tasks), the store lock, the
 * Owner waits, the capability registry, the Tool gate, and the merged bot
 * activity. Turns run on an `AgentEngine` it picks per conversation (ADR
 * 0014): the Claude plan engine while it runs the conversation, pi
 * otherwise. It calls engines only through that interface; what the Claude
 * plan has apart from conversations is `claudePlan`.
 */
export class AgentRuntime {
  readonly #store: ConversationStore;
  readonly #pi: AgentEngine;
  readonly #claude: AgentEngine;
  readonly #engines: readonly AgentEngine[];
  readonly #gate: ToolGate;
  readonly #models: MutableModels;
  #catalog: ModelCatalog;
  #credentials: CredentialResolver;
  /** pi-ai provider ids the accounts built (the ones `applyModelConfig` may replace). */
  #built = new Set<string>();
  readonly #lock: StoreLock | undefined;
  readonly #activityListeners = new Set<(change: ActivityChange) => void>();
  readonly #registry: Registry;
  readonly #approvals: WaitTracker;
  readonly #questions: WaitTracker;
  readonly #capabilities = new Map<string, Capability>();
  /** Conversations replying on any engine. */
  #busy = new Set<ConversationRef>();
  #closed = false;

  /** The model registry this runtime runs with (built or passed at open). */
  get models(): MutableModels {
    return this.#models;
  }

  /** What every model row is: the picker list, routing, roles, accounts. */
  get catalog(): ModelCatalog {
    return this.#catalog;
  }

  /**
   * Replace the model configuration while running (the owner changed
   * Settings → Models). Running turns keep the model they resolved; the next
   * request sees the change. Providers the host passed in are left alone.
   */
  applyModelConfig(config: ModelConfig): void {
    const providers = buildProviders(config, this.#credentials);
    const next = new Set(providers.map((provider) => provider.id));
    for (const id of this.#built) {
      if (!next.has(id)) this.#models.deleteProvider(id);
    }
    for (const provider of providers) this.#models.setProvider(provider);
    this.#built = next;
    this.#catalog = createModelCatalog(config, this.#models);
  }

  /**
   * The Claude plan apart from any conversation: its switch and fallback
   * (from the catalog), whether its worker is set up and signed in, and
   * setting the worker up ahead of the first turn. No secrets.
   */
  readonly claudePlan: ClaudePlan;

  private constructor(
    harness: Harness,
    models: MutableModels,
    credentials: CredentialResolver,
    lock: StoreLock | undefined,
    registry: Registry,
    gate: ToolGate,
    approvals: WaitTracker,
    questions: WaitTracker,
    capabilities: readonly Capability[],
    legacyPath?: string,
    claudeWorker?: ClaudeWorkerLocator,
    claudeConnect?: (url: string, token: string) => WebSocketLike,
    onReport?: (error: unknown) => void,
  ) {
    this.#store = new ConversationStore(harness, {
      onReplying: (ref) => this.#busyChanged(ref),
    });
    this.#gate = gate;
    this.#pi = new PiEngine(this.#store);
    this.claudePlan = new ClaudePlan({
      state: () => claudePlanState(this.#catalog),
      ...(claudeWorker ? { worker: claudeWorker } : {}),
    });
    this.#claude = new ClaudeCodeEngine({
      harness,
      plan: () => this.claudePlan.state(),
      ...(legacyPath ? { legacyPath } : {}),
      worker: claudeWorker,
      ...(claudeConnect ? { connect: claudeConnect } : {}),
      onBusy: (ref) => this.#busyChanged(ref),
      // A queued Claude plan turn found the plan unavailable with the gateway
      // fallback: the conversation left the plan, and pi answers the message.
      fallback: async (ref, input) => {
        await this.#pi.submit(ref, input);
      },
      ...(onReport ? { onReport } : {}),
      gate,
    });
    this.#engines = [this.#pi, this.#claude];
    this.#models = models;
    this.#credentials = credentials;
    this.#catalog = createModelCatalog(EMPTY_MODEL_CONFIG, models);
    this.#lock = lock;
    this.#registry = registry;
    this.#approvals = approvals;
    this.#questions = questions;
    for (const capability of capabilities) this.#capabilities.set(capability.id, capability);
    approvals.onChange((conversation) => this.#emitActivity(this.#activity(conversation)));
    questions.onChange((conversation) => this.#emitActivity(this.#activity(conversation)));
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
    let storage: Storage | undefined;
    let harness: Harness | undefined;
    let runtime: AgentRuntime | undefined;
    try {
      storage = inMemory ? new MemoryStorage() : await openNodeSqliteStorage(options.storePath);
      const models = options.models ?? createModels();
      const credentials = options.credentials ?? noCredentials;
      // Providers first: resume() below may re-run a turn on them.
      const initial = buildProviders(options.modelConfig ?? EMPTY_MODEL_CONFIG, credentials);
      for (const provider of initial) models.setProvider(provider);
      const registry = createRegistry();
      const approvals = options.approvalTracker ?? new WaitTracker();
      const questions = new WaitTracker();
      // Questions for the owner wait on a document this runtime answers, so
      // the runtime brings their capability; conversations select it by id.
      // Tool search is the runtime's too: every bot has deferred toolkits
      // (browser, computer), and large connections defer theirs.
      const capabilities = [
        ...(options.capabilities ?? []),
        createQuestionsCapability(questions),
        createToolSearchCapability((id) => runtime?.capabilityInfo(id)),
      ];
      // Installed first, so conversations that never chose capabilities (they
      // select every installed extension) get the trim too.
      registry.install(createContextTrimExtension());
      for (const extension of options.extensions ?? []) registry.install(extension);
      // Capabilities must be installed before resume(): interrupted calls of
      // their tools (e.g. a pending approval or question) re-run against them.
      // The gate reads the owner's messages and records answers through the
      // Harness opened below.
      const gate = new ToolGate({
        approvals,
        // Out of the calling tool's own invocation: aborting joins it.
        stop: (conversation) => {
          setTimeout(() => {
            runtime?.abort(conversation).catch(() => undefined);
          }, 0);
        },
        ...(options.reviewer ? { reviewer: options.reviewer } : {}),
        ...(options.ownerUserId ? { ownerUserId: options.ownerUserId } : {}),
        store: {
          decide: async (conversation, taskId, decision, grant) => {
            try {
              await harness!.commit(
                (tx) => recordDecision(tx, conversation, taskId, decision, grant),
                ctx,
              );
            } catch (error) {
              approvalNotPending(error, taskId);
            }
          },
          approveForYolo: (conversation, taskId) =>
            harness!.commit((tx) => recordYoloDecision(tx, conversation, taskId), ctx),
          grant: (conversation, grant) =>
            harness!.commit(async (tx) => {
              const grants = await tx.doc(GrantsDoc, conversation as ConversationId);
              if (!grants.grants.includes(grant)) grants.grants.push(grant);
            }, ctx),
        },
      });
      // The pi engine is built once the harness is open; its calls only
      // run after that (resume() comes last).
      let pi: AgentEngine | undefined;
      const userMessages = async (id: number) => (pi ? pi.userMessages(id) : []);
      for (const capability of capabilities) {
        registry.install(gateExtension(capability.extension, gate, userMessages));
      }
      harness = await Harness.open(
        storage,
        {
          models,
          registry,
          settings: {
            ...options.settings,
            // Long chats are summarized past the context ceiling on every model.
            compaction: withContextCeiling(models, {
              enabled: true,
              ...options.settings?.compaction,
            }),
          },
          onReport: options.onReport,
        },
        ctx,
      );
      const opened = new AgentRuntime(
        harness,
        models,
        credentials,
        lock,
        registry,
        gate,
        approvals,
        questions,
        capabilities,
        // The Claude plan's transcripts before ADR 0018: imported once at start.
        inMemory ? undefined : `${options.storePath}.claude.json`,
        options.claudeWorker,
        options.claudeConnect,
        options.onReport,
      );
      opened.applyModelConfig(options.modelConfig ?? EMPTY_MODEL_CONFIG);
      runtime = opened;
      pi = opened.#pi;
      harness.closed.then((end) => {
        if (end.reason === "failed" && !opened.#closed) options.onFatal?.(end.error);
      });
      await opened.#store.start();
      for (const engine of opened.#engines) await engine.start();
      // The Claude plan starts idle (its turns do not survive a restart):
      // what replies now is what the store's task graph shows.
      opened.#busy = new Set(opened.#store.replyingConversations());
      opened.#store.resume();
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

  /**
   * The engine that runs the conversation's turns: the Claude plan engine
   * while the bot is on a Claude plan model and the conversation has not
   * fallen back, pi otherwise.
   */
  #engineFor(ref: ConversationRef): AgentEngine {
    return this.#claude.runs(ref) ? this.#claude : this.#pi;
  }

  /** Every engine takes its part of the compiled config. */
  async #configureEngines(ref: ConversationRef, compiled: CompiledConversation): Promise<void> {
    for (const engine of this.#engines) await engine.configure(ref, compiled);
  }

  /** An engine's busy flag moved: the merged one may have. */
  #busyChanged(ref: ConversationRef): void {
    const was = this.#busy.has(ref);
    const now = this.#engines.some((engine) => engine.busy(ref));
    if (now) this.#busy.add(ref);
    else this.#busy.delete(ref);
    if (was !== now) this.#emitActivity(this.#activity(ref));
  }

  // ── Conversations ─────────────────────────────────────────────────────

  async createConversation(config: BotAgentConfig): Promise<ConversationRef> {
    const compiled = this.#compile(config);
    // Every conversation has its durable pi conversation: the store of its
    // documents, and the transcript a Claude plan conversation falls back onto.
    const ref = await this.#store.create(compiled);
    await this.#configureEngines(ref, compiled);
    return ref;
  }

  /**
   * Change persona, model and capabilities. Applies from the next model
   * request; history is kept.
   */
  async configure(ref: ConversationRef, config: BotAgentConfig): Promise<void> {
    const compiled = this.#compile(config);
    await this.#store.configure(ref, compiled);
    await this.#configureEngines(ref, compiled);
  }

  // ── YOLO mode (issue #151) ────────────────────────────────────────────

  /** Tokens the conversation has used so far: a routine run's spend, as it starts fresh each run. */
  usedTokens(ref: ConversationRef): Promise<number> {
    return this.#store.usedTokens(ref);
  }

  /** The conversation's token and cost totals (Traces, issue #363). */
  usage(ref: ConversationRef): Promise<ConversationUsage> {
    return this.#store.usage(ref);
  }

  /** The conversation's model and tool calls, turn by turn (Traces, issue #363). */
  trace(ref: ConversationRef): Promise<ConversationTrace> {
    return this.#store.trace(ref);
  }

  /** Whether the conversation's YOLO mode is on. */
  async yolo(ref: ConversationRef): Promise<boolean> {
    return (await this.#store.yolo(ref)).on;
  }

  /**
   * Switch the conversation's YOLO mode: while on, every tool call that
   * would ask the owner runs without a card, except vault uses and turns
   * another bot or a guest started. `by` is the owner's user id (whose
   * messages it trusts in a shared chat). Switching it on also approves
   * the calls already waiting that it would have run; their task ids are
   * returned. The Tool gate reads the document on each call, whichever
   * engine runs the conversation.
   */
  async setYolo(
    ref: ConversationRef,
    on: boolean,
    by?: number,
  ): Promise<{ on: boolean; approved: number[] }> {
    await this.#store.setYolo(ref, on, by);
    const approved = on
      ? await this.#gate.approveWaiting(ref, by, () => this.#engineFor(ref).userMessages(ref))
      : [];
    return { on, approved };
  }

  /**
   * A bot's config as pi-durable stores it (the agent change) and as the
   * gate reads it (the permissions), compiled by `policy.ts`. Without a
   * capability selection the conversation keeps its tools.
   */
  #compile(config: BotAgentConfig): CompiledConversation {
    const route = this.#catalog.route(config.modelId);
    if (!route) {
      throw new ModelUnavailableError(
        config.modelId,
        this.#catalog.get(config.modelId)?.unavailableReason ?? "missing",
      );
    }
    const instructions = config.systemPrompt.trim() ? config.systemPrompt : null;
    if (route.engine === "claude-code") {
      // pi-durable stores a pi model too: the stand-in a fallback turn runs
      // on. The account's fallback model, else any pi model, else the Claude
      // plan model itself (never called: without a fallback a turn pauses).
      const fallbackId = this.#catalog.claudePlan()?.fallbackModelId;
      const fallback = (fallbackId && this.#catalog.route(fallbackId)) || undefined;
      const anyPi = this.#catalog
        .list({ type: "chat" })
        .find((m) => m.available && m.engine === "pi");
      const standIn = fallback ?? (anyPi ? this.#catalog.route(anyPi.id) : undefined) ?? route;
      const surface = claudeToolSurface(this.#capabilities, config.capabilities);
      const change: AgentChange = {
        model: { provider: standIn.providerId, modelId: standIn.upstreamId },
        instructions,
      };
      const claude: CompiledConversation["claude"] = {
        model: route.upstreamId,
        system: config.systemPrompt,
        tools: surface.tools,
        permissions: surface.permissions,
        runners: surface.runners,
      };
      // Without a selection every Claude plan tool asks (no tool is allowed).
      if (!config.capabilities) return { change, permissions: { allow: [] }, claude };
      const policy = compilePolicy(
        this.#capabilities,
        config.capabilities,
        this.#registry.snapshot(),
      );
      return {
        change: { ...change, extensions: policy.extensions, tools: { remove: policy.remove } },
        permissions: policy.permissions,
        claude,
      };
    }
    const change: AgentChange = {
      model: { provider: route.providerId, modelId: route.upstreamId },
      instructions,
    };
    if (!config.capabilities) return { change };
    const policy = compilePolicy(
      this.#capabilities,
      config.capabilities,
      this.#registry.snapshot(),
    );
    return {
      change: {
        ...change,
        // pi-durable stores names: a capability installed later (an MCP server
        // reconnecting) is picked up by name without reconfiguring.
        extensions: policy.extensions,
        tools: { remove: policy.remove },
      },
      permissions: policy.permissions,
    };
  }

  // ── Capabilities ──────────────────────────────────────────────────────

  listCapabilities(): CapabilityInfo[] {
    return [...this.#capabilities.values()].map(capabilityInfo);
  }

  /** One installed capability's info, by id. */
  capabilityInfo(id: string): CapabilityInfo | undefined {
    const capability = this.#capabilities.get(id);
    return capability ? capabilityInfo(capability) : undefined;
  }

  /**
   * Install or replace a capability while running (an MCP connection that
   * (re)connected or changed its tools). Conversations select it by name, so
   * bots that enabled it pick it up from their next model request.
   */
  installCapability(capability: Capability): void {
    this.#capabilities.set(capability.id, capability);
    this.#registry.install(
      gateExtension(capability.extension, this.#gate, (id) => this.#pi.userMessages(id)),
    );
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
    return this.#gate.waiting(ref);
  }

  /**
   * Upload ids attached to the conversation's recent sends (issue #17):
   * what see_image may read. Bounded to the newest 50 user entries; a bot
   * referencing an attachment older than that gets the not-found result.
   */
  attachmentIds(ref: ConversationRef): Promise<string[]> {
    return this.#store.attachmentIds(ref);
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
    await this.#gate.decide(ref, taskId, decision, options);
  }

  // ── Credential requests ───────────────────────────────────────────────

  /**
   * A `request_credentials` call still waiting for the owner, with its
   * conversation. Throws `CredentialRequestNotPendingError` otherwise.
   */
  async credentialRequest(
    taskId: number,
  ): Promise<{ conversation: ConversationRef; request: CredentialRequest; expiresAt: number }> {
    try {
      return await this.#store.harness.commit((tx) => readPendingRequest(tx, taskId), ctx);
    } catch (error) {
      credentialRequestNotPending(error, taskId);
    }
  }

  /** Settle a credential request with the owner's outcome (never values). */
  async settleCredentialRequest(taskId: number, outcome: CredentialRequestOutcome): Promise<void> {
    try {
      await this.#store.harness.commit((tx) => settleRequest(tx, taskId, outcome), ctx);
    } catch (error) {
      credentialRequestNotPending(error, taskId);
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
    try {
      await this.#store.harness.commit((tx) => recordAnswers(tx, ref, taskId, answers), ctx);
    } catch (error) {
      questionNotPending(error, taskId);
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
   * Durably admit a user message and return; the reply runs after. Retrying
   * with the same `requestId` never submits twice. While a reply is running,
   * the message is queued: on pi a steer (`whenBusy: "steer"`) joins the
   * reply after its current tool round; the default follow-up (and, on the
   * Claude plan, a steer too) is answered by the next turn.
   */
  async submit(ref: ConversationRef, input: EngineSubmission): Promise<void> {
    const engine = this.#engineFor(ref);
    if ((await engine.submit(ref, input)) === "accepted") return;
    // The engine cannot run the turn and its fallback is the gateway: it let
    // the conversation go, which moves onto its pi transcript for good (ADR 0008).
    await this.#pi.submit(ref, input);
  }

  /** Stop the in-flight reply (and withdraw queued inputs). */
  async abort(ref: ConversationRef): Promise<void> {
    await this.#engineFor(ref).abort(ref);
  }

  /**
   * Withdraw a message by its request id. A queued input leaves the queue
   * (on pi, settling `unanswered`, reason `aborted`); a placed one is
   * already part of the running reply, and a settled one is done.
   */
  withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    return this.#engineFor(ref).withdraw(ref, requestId);
  }

  isBusy(ref: ConversationRef): boolean {
    return this.#busy.has(ref);
  }

  busyConversations(): ConversationRef[] {
    return [...this.#busy];
  }

  /** The newest user or assistant message with something to show (the Bot list preview). */
  async lastMessage(ref: ConversationRef): Promise<LastMessage | undefined> {
    return lastMessageOf((await this.readChat(ref)).messages);
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
    return state.messages.flatMap((message) => finishedReplyOf(message) ?? []);
  }

  /**
   * The conversation's chat state right now, for one-shot readers (Settled,
   * Deliveries, Routine runs, memory capture, history) that need the
   * transcript but no stream.
   */
  readChat(ref: ConversationRef): Promise<ChatState> {
    return this.#engineFor(ref).read(ref);
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
   * upserts/deltas per change. Reconnecting clients simply watch again.
   * With `window`, snapshots carry only the newest `window` messages plus
   * `hasMore`/`cursor` (issue #92).
   */
  watchChat(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number } = {},
  ): Promise<ChatSubscription> {
    return this.#engineFor(ref).watch(ref, listener, options);
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

  /** Stop the engines, close the store (waits for running task code) and release the lock. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled(this.#engines.map((engine) => engine.close()));
    try {
      await this.#store.close();
    } finally {
      this.#lock?.release();
    }
  }
}
