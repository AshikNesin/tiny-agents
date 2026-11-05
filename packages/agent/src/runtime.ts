import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MutableModels } from "@earendil-works/pi-ai/models";
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
import { capabilityInfo, type Capability, type CapabilityInfo } from "./capabilities";
import { acquireStoreLock, type StoreLock } from "./lock";
import {
  aiProviderIds,
  assertNoClaudeOauthToken,
  configuredProviderIds,
  createProviderModels,
  primaryProviderId,
  providerSetupHint,
  toModelInfo,
  type ProviderStatus,
} from "./models";
import { gateExtension, PiEngine } from "./engines/pi";
import {
  claudeCodeBareModel,
  ConversationNotFoundError,
  engineKindForConfig,
  type AgentEngine,
  type CompiledConversation,
  type EngineSubmission,
} from "./engine";
import { claudePlanModels } from "./engines/claude-code/catalog";
import type { WebSocketLike } from "./engines/claude-code/client";
import { ClaudeCodeEngine } from "./engines/claude-code/engine";
import type {
  ClaudeAccountStatus,
  ClaudeWorkerLocator,
} from "./engines/claude-code/sandbox-worker";
import { claudeToolSurface } from "./engines/claude-code/tools";
import { ToolGate } from "./gate";
import { compilePolicy, YoloDoc, resolveModelId } from "./policy";
import {
  createQuestionsCapability,
  QuestionNotPendingError,
  questionNotPending,
  recordAnswers,
} from "./toolkits/questions";
import { finishedReplyOf } from "./replies";
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
  ModelInfo,
  OwnerAnswer,
  WaitEvent,
  WithdrawOutcome,
} from "./types";
import { WaitTracker } from "./waiting";
import type { Reviewer } from "./reviewer";
import { GrantsDoc } from "./vault";

// The three wait kinds own their not-pending errors; the app imports them from here.
export { ApprovalNotPendingError, CredentialRequestNotPendingError, QuestionNotPendingError };
export { ConversationNotFoundError };

const ctx: Context = BACKGROUND_CONTEXT;

export class ModelNotFoundError extends Error {
  constructor(modelId: string) {
    super(`Unknown model "${modelId}"`);
    this.name = "ModelNotFoundError";
  }
}

export interface AgentRuntimeOptions {
  /** Path of the pi-durable SQLite store, or ":memory:" (tests). */
  storePath: string;
  /** Model registry; defaults to the AI_PROVIDERS providers (Cloudflare AI Gateway when unset). */
  models?: MutableModels;
  /** Provider id bare model ids resolve against. Defaults to the first of AI_PROVIDERS. */
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

/**
 * The single owner of pi-durable in tiny-agents (PRD §7.2). One instance per
 * process, opened at boot before the HTTP server accepts requests.
 *
 * It owns the store (the pi-durable harness, its lock, and every
 * conversation's documents: permissions, YOLO, Owner waits), the capability
 * registry, the Tool gate, and the merged bot activity. Turns run on an
 * `AgentEngine` it picks per conversation (ADR 0013): the Claude plan
 * engine while it runs the conversation, pi otherwise.
 */
export class AgentRuntime {
  readonly provider: string;
  readonly #harness: Harness;
  readonly #pi: PiEngine;
  readonly #claude: ClaudeCodeEngine;
  readonly #engines: readonly AgentEngine[];
  readonly #gate: ToolGate;
  readonly #models: MutableModels;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #lock: StoreLock | undefined;
  readonly #activityListeners = new Set<(change: ActivityChange) => void>();
  readonly #registry: Registry;
  readonly #approvals: WaitTracker;
  readonly #questions: WaitTracker;
  readonly #capabilities = new Map<string, Capability>();
  /** Providers whose auth resolved at open (the env is snapshotted then too). */
  #configured: ReadonlySet<string> = new Set();
  /** The configured providers' ids, primary first (AI_PROVIDERS order). */
  #providerIds: readonly string[] = [];
  /** Conversations replying on any engine. */
  #busy = new Set<ConversationRef>();
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
    gate: ToolGate,
    approvals: WaitTracker,
    questions: WaitTracker,
    capabilities: readonly Capability[],
    envSource: Readonly<Record<string, string | undefined>> = process.env,
    persistPath?: string,
    claudeWorker?: ClaudeWorkerLocator,
    claudeConnect?: (url: string, token: string) => WebSocketLike,
  ) {
    this.#harness = harness;
    this.#gate = gate;
    this.#pi = new PiEngine(harness, { onBusy: (ref) => this.#busyChanged(ref) });
    this.#claude = new ClaudeCodeEngine({
      env: () => process.env,
      persistPath,
      worker: claudeWorker,
      ...(claudeConnect ? { connect: claudeConnect } : {}),
      onBusy: (ref) => this.#busyChanged(ref),
      gate,
      docs: harness,
    });
    this.#engines = [this.#pi, this.#claude];
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
    // Snapshot the env at open, so later changes to process.env never shift
    // the runtime's provider config. Callers that swap the provider (faux
    // boot, tests) pass their own snapshot, e.g. without GATEWAY_MODEL_ALLOWLIST.
    const envSource: Readonly<Record<string, string | undefined>> = options.env
      ? { ...options.env }
      : { ...process.env };
    assertNoClaudeOauthToken(envSource);
    const inMemory = options.storePath === ":memory:";
    const lock = inMemory
      ? undefined
      : acquireStoreLock(options.storePath, { waitMs: options.lockWaitMs });
    let storage: Storage | undefined;
    let harness: Harness | undefined;
    let runtime: AgentRuntime | undefined;
    try {
      storage = inMemory ? new MemoryStorage() : await openNodeSqliteStorage(options.storePath);
      const models = options.models ?? createProviderModels(envSource);
      const configured = await configuredProviderIds(models);
      const registry = createRegistry();
      const approvals = options.approvalTracker ?? new WaitTracker();
      const questions = new WaitTracker();
      // Questions for the owner wait on a document this runtime answers, so
      // the runtime brings their capability; conversations select it by id.
      const capabilities = [...(options.capabilities ?? []), createQuestionsCapability(questions)];
      for (const extension of options.extensions ?? []) registry.install(extension);
      // Capabilities must be installed before resume(): interrupted calls of
      // their tools (e.g. a pending approval or question) re-run against them.
      // The gate reads the owner's messages and records answers through the
      // Harness opened below.
      const gate = new ToolGate({
        approvals,
        ...(options.reviewer ? { reviewer: options.reviewer } : {}),
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
      let pi: PiEngine | undefined;
      const userMessages = async (id: number) => (pi ? pi.userMessages(id) : []);
      for (const capability of capabilities) {
        registry.install(gateExtension(capability.extension, gate, userMessages));
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
        options.provider ?? primaryProviderId(envSource),
        lock,
        registry,
        gate,
        approvals,
        questions,
        capabilities,
        envSource,
        inMemory ? undefined : `${options.storePath}.claude.json`,
        options.claudeWorker,
        options.claudeConnect,
      );
      opened.#configured = configured;
      opened.#providerIds = [opened.provider, ...aiProviderIds(envSource)].filter(
        (id, index, all) => all.indexOf(id) === index && models.getProvider(id) !== undefined,
      );
      runtime = opened;
      pi = opened.#pi;
      harness.closed.then((end) => {
        if (end.reason === "failed" && !opened.#closed) options.onFatal?.(end.error);
      });
      await opened.#pi.start();
      opened.#busy = new Set(opened.#pi.busyConversations());
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
    // The primary provider's models plus every other registered provider's
    // (AI_PROVIDERS extras such as openai, and gateway custom providers),
    // whose ids are namespaced "custom:<provider>/<model>" so bots' saved
    // modelIds stay stable and never collide with the primary's ids.
    // Once any provider is configured, unconfigured providers' models are
    // left out: they could not answer. With none configured all are listed
    // and the client shows the setup banner.
    const anyConfigured = this.#configured.size > 0;
    const listed = (id: string) => !anyConfigured || this.#configured.has(id);
    const nameOf = (id: string) => this.#models.getProvider(id)?.name ?? id;
    const primary = listed(this.provider)
      ? this.#models
          .getModels(this.provider)
          .map((m) => toModelInfo(m, undefined, nameOf(m.provider)))
      : [];
    const others = this.#models
      .getProviders()
      .filter((p) => p.id !== this.provider && listed(p.id))
      .flatMap((p) =>
        this.#models
          .getModels(p.id)
          .map((model) => toModelInfo(model, `custom:${p.id}`, nameOf(p.id))),
      );
    const all = [...primary, ...others, ...claudePlanModels()];
    const allow = modelAllowlist(this.#env);
    return allow ? all.filter((m) => allow.has(m.id)) : all;
  }

  /**
   * The inference providers this runtime was configured with (AI_PROVIDERS,
   * or the provider it was opened on) and whether each has credentials.
   */
  providerStatus(): ProviderStatus[] {
    return this.#providerIds.map((id) => {
      const name = this.#models.getProvider(id)?.name ?? id;
      return {
        id,
        name,
        configured: this.#configured.has(id),
        setupHint: providerSetupHint(id, name),
      };
    });
  }

  /** True when at least one inference provider has credentials. */
  hasConfiguredProvider(): boolean {
    return this.providerStatus().some((status) => status.configured);
  }

  /** Kill switch, fallback, and whether a worker URL is configured. No secrets. */
  claudeCodeStatus(): ReturnType<ClaudeCodeEngine["status"]> {
    return this.#claude.status();
  }

  /** Whether Claude Code is installed and signed in on the worker's machine. No secrets. */
  claudeCodeAccount(): Promise<ClaudeAccountStatus> {
    return this.#claude.account();
  }

  /** Start setting up the sandbox worker (when the engine is on), so the first turn is quick. */
  prepareClaudeCode(): void {
    this.#claude.prepare();
  }

  hasModel(modelId: string): boolean {
    if (claudeCodeBareModel(modelId)) return true;
    return this.#resolveModel(modelId) !== undefined;
  }

  #anyCatalogModel(): { provider: string; model: string } | undefined {
    const model = this.#models.getModels(this.provider)[0];
    return model ? { provider: this.provider, model: model.id } : undefined;
  }

  /** A pi model a Claude-plan conversation can fall back onto. */
  #standInForClaude(bare: string): { provider: string; model: string } | undefined {
    const onPrimary = this.#resolveModel(bare);
    if (onPrimary) return onPrimary;
    for (const provider of this.#models.getProviders()) {
      if (provider.id === this.provider) continue;
      if (this.#models.getModel(provider.id, bare)) return { provider: provider.id, model: bare };
    }
    return this.#anyCatalogModel();
  }

  #resolveModel(modelId: string): { provider: string; model: string } | undefined {
    return resolveModelId(
      modelId,
      this.provider,
      (provider, model) => this.#models.getModel(provider, model) !== undefined,
    );
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
    const ref = await this.#pi.create(compiled);
    await this.#claude.configure(ref, compiled);
    return ref;
  }

  /**
   * Change persona, model and capabilities. Applies from the next model
   * request; history is kept.
   */
  async configure(ref: ConversationRef, config: BotAgentConfig): Promise<void> {
    await this.#configureEngines(ref, this.#compile(config));
  }

  // ── YOLO mode (issue #151) ────────────────────────────────────────────

  /** Whether the conversation's YOLO mode is on. */
  async yolo(ref: ConversationRef): Promise<boolean> {
    return (await this.#readYolo(ref)).on;
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
    await this.#conversation(ref);
    await this.#harness.commit(async (tx) => {
      const doc = await tx.doc(YoloDoc, ref as ConversationId);
      doc.on = on;
      if (on) {
        doc.since = Date.now();
        if (by !== undefined) doc.by = by;
        else delete doc.by;
      } else {
        delete doc.since;
        delete doc.by;
      }
    }, ctx);
    const approved = on
      ? await this.#gate.approveWaiting(ref, by, () => this.#engineFor(ref).userMessages(ref))
      : [];
    return { on, approved };
  }

  async #readYolo(ref: ConversationRef): Promise<{ on: boolean; by?: number }> {
    await this.#conversation(ref);
    return this.#harness.commit(async (tx) => {
      const doc = await tx.doc(YoloDoc, ref as ConversationId);
      return doc.on ? { on: true, ...(doc.by !== undefined ? { by: doc.by } : {}) } : { on: false };
    }, ctx);
  }

  /**
   * A bot's config as pi-durable stores it (the agent change) and as the
   * gate reads it (the permissions), compiled by `policy.ts`. Without a
   * capability selection the conversation keeps its tools.
   */
  #compile(config: BotAgentConfig): CompiledConversation {
    const bare = claudeCodeBareModel(config.modelId);
    if (engineKindForConfig(config) === "claude-code") {
      if (!bare) throw new ModelNotFoundError(config.modelId);
      // The harness stores a real catalog model so a gateway/provider fallback
      // can run there. It is not called unless this turn is handed to pi.
      // Prefer the same model id on any configured provider (the primary one
      // first), then any model of the primary provider.
      const resolved = this.#standInForClaude(bare);
      if (!resolved) throw new ModelNotFoundError(config.modelId);
      const surface = claudeToolSurface(this.#capabilities, config.capabilities);
      const change: AgentChange = {
        model: { provider: resolved.provider, modelId: resolved.model },
        instructions: config.systemPrompt.trim() ? config.systemPrompt : null,
      };
      const claude: CompiledConversation["claude"] = {
        model: bare,
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
    const resolved = this.#resolveModel(config.modelId);
    if (!resolved) throw new ModelNotFoundError(config.modelId);
    const change: AgentChange = {
      model: { provider: resolved.provider, modelId: resolved.model },
      instructions: config.systemPrompt.trim() ? config.systemPrompt : null,
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
    return this.#pi.attachmentIds(ref);
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
      return await this.#harness.commit((tx) => readPendingRequest(tx, taskId), ctx);
    } catch (error) {
      credentialRequestNotPending(error, taskId);
    }
  }

  /** Settle a credential request with the owner's outcome (never values). */
  async settleCredentialRequest(taskId: number, outcome: CredentialRequestOutcome): Promise<void> {
    try {
      await this.#harness.commit((tx) => settleRequest(tx, taskId, outcome), ctx);
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
      await this.#harness.commit((tx) => recordAnswers(tx, ref, taskId, answers), ctx);
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
   * Durably admit a user message. Retrying with the same `requestId` never
   * submits twice. While a reply is running, the message is queued: a steer
   * (`whenBusy: "steer"`) joins the reply after its current tool round; the
   * default follow-up is answered by the next run. On the Claude plan this
   * runs the whole turn.
   */
  async submit(ref: ConversationRef, input: EngineSubmission): Promise<void> {
    const engine = this.#engineFor(ref);
    if ((await engine.submit(ref, input)) === "accepted") return;
    // The engine cannot run the turn and its fallback is the gateway: the
    // conversation moves onto its pi transcript for good (ADR 0008).
    this.#claude.leave(ref);
    await this.#pi.submit(ref, input);
  }

  /** Stop the in-flight reply (and withdraw queued inputs). */
  async abort(ref: ConversationRef): Promise<void> {
    await this.#engineFor(ref).abort(ref);
  }

  /**
   * Withdraw a message by its request id. A queued input leaves the inbox
   * (settling `unanswered`, reason `aborted`); a placed one is already part
   * of the running reply, and a settled one is done. Only pi queues.
   */
  withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    return this.#pi.withdraw(ref, requestId);
  }

  isBusy(ref: ConversationRef): boolean {
    return this.#busy.has(ref);
  }

  busyConversations(): ConversationRef[] {
    return [...this.#busy];
  }

  lastMessage(ref: ConversationRef): Promise<LastMessage | undefined> {
    return this.#engineFor(ref).lastMessage(ref);
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
  readChatPage(
    ref: ConversationRef,
    query: { before: string; limit: number },
  ): Promise<ChatPage | undefined> {
    return this.#engineFor(ref).page(ref, query);
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

  /** Stop the engines, close the Harness (waits for running task code) and release the lock. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled(this.#engines.map((engine) => engine.close()));
    try {
      await this.#harness.close(ctx);
    } finally {
      this.#lock?.release();
    }
  }

  /** The conversation's durable record; throws `ConversationNotFoundError`. */
  async #conversation(ref: ConversationRef): Promise<void> {
    const conversation = await this.#harness.conversation(ref as ConversationId, ctx);
    if (!conversation) throw new ConversationNotFoundError(ref);
  }
}
