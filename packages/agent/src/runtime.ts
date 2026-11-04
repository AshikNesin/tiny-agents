import type { Context, JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
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
  type Conversation,
  type ConversationId,
  type Cursor,
  type EntryRecord,
  type HarnessSettings,
  type Registry,
  type Storage,
  type TaskGraphWatch,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import {
  ApprovalNotPendingError,
  approvalNotPending,
  gateExtension,
  recordDecision,
  recordYoloDecision,
  type ApprovalDecision,
  type GateYolo,
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
import { PiEngine } from "./engines/pi";
import { claudeCodeBareModel, engineKindForConfig } from "./engine";
import { claudePlanModels } from "./engines/claude-code/catalog";
import { ClaudeCodeEngine, type ClaudeSessionSync } from "./engines/claude-code/engine";
import type {
  ClaudeAccountStatus,
  ClaudeWorkerLocator,
} from "./engines/claude-code/sandbox-worker";
import {
  claudeToolApi,
  claudeToolSurface,
  type ClaudeToolRunner,
} from "./engines/claude-code/tools";
import {
  applyPermissions,
  compilePolicy,
  ownerTurn,
  PermissionsDoc,
  YoloDoc,
  resolveModelId,
  type CompiledPolicy,
} from "./policy";
import { ChatProjection, unansweredOf, type ProjectionSnapshot } from "./projection";
import {
  createQuestionsCapability,
  QuestionNotPendingError,
  questionNotPending,
  recordAnswers,
} from "./toolkits/questions";
import { finishedReplyOf } from "./replies";
import {
  attachmentsOf,
  CHAT_USER_ENTRY,
  modelErrorText,
  pageBefore,
  queuedOf,
  textOf,
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
  ConversationRef,
  FinishedReply,
  LastMessage,
  ModelInfo,
  OwnerAnswer,
  QueuedMessage,
  WaitEvent,
  WithdrawOutcome,
} from "./types";

// The three wait kinds own their not-pending errors; the app imports them from here.
export { ApprovalNotPendingError, CredentialRequestNotPendingError, QuestionNotPendingError };
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
  readonly #pi: PiEngine;
  readonly #claude: ClaudeCodeEngine;
  readonly #claudeRunners = new Map<ConversationRef, Map<string, ClaudeToolRunner>>();
  readonly #claudeBusy = new Set<ConversationRef>();
  readonly #models: MutableModels;
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #lock: StoreLock | undefined;
  readonly #chats = new Set<ChatSubscription>();
  readonly #activityListeners = new Set<(change: ActivityChange) => void>();
  readonly #registry: Registry;
  readonly #approvals: WaitTracker;
  readonly #questions: WaitTracker;
  readonly #capabilities = new Map<string, Capability>();
  /** Providers whose auth resolved at open (the env is snapshotted then too). */
  #configured: ReadonlySet<string> = new Set();
  /** The configured providers' ids, primary first (AI_PROVIDERS order). */
  #providerIds: readonly string[] = [];
  #review: GateReview | undefined;
  #yoloGate: GateYolo | undefined;
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
    persistPath?: string,
    claudeWorker?: ClaudeWorkerLocator,
  ) {
    this.#pi = new PiEngine(harness);
    this.#claude = new ClaudeCodeEngine({
      env: () => process.env,
      persistPath,
      worker: claudeWorker,
      onBusy: (ref, busy) => this.#setClaudeBusy(ref, busy),
      execute: (ref, call) => this.#executeClaudeTool(ref, call),
    });
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
      // Auto-review reads the owner's messages through the Harness opened below.
      const recentEntries = async (id: number) => {
        const conversation = await harness?.conversation(id as ConversationId, ctx);
        if (!conversation) return [];
        const page = await conversation.entries(
          { order: "descending" },
          REVIEW_ENTRY_LOOKBACK,
          undefined,
          ctx,
        );
        return page.items;
      };
      const review: GateReview | undefined = options.reviewer
        ? { reviewer: options.reviewer, recentEntries }
        : undefined;
      // YOLO mode reads the newest user message to trust only the owner's turns.
      const yolo: GateYolo = { recentEntries };
      for (const capability of capabilities) {
        registry.install(gateExtension(capability.extension, approvals, review, yolo));
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
        approvals,
        questions,
        capabilities,
        envSource,
        inMemory ? undefined : `${options.storePath}.claude.json`,
        options.claudeWorker,
      );
      opened.#review = review;
      opened.#yoloGate = yolo;
      opened.#configured = configured;
      opened.#providerIds = [opened.provider, ...aiProviderIds(envSource)].filter(
        (id, index, all) => all.indexOf(id) === index && models.getProvider(id) !== undefined,
      );
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

  #rememberClaude(
    ref: ConversationRef,
    claude: (ClaudeSessionSync & { runners: Map<string, ClaudeToolRunner> }) | undefined,
  ): void {
    if (!claude) {
      this.#claude.detach(ref);
      this.#claudeRunners.delete(ref);
      return;
    }
    const { runners, ...sync } = claude;
    this.#claude.sync(ref, sync);
    this.#claudeRunners.set(ref, runners);
  }

  async #executeClaudeTool(
    ref: ConversationRef,
    call: { name: string; input: unknown },
  ): Promise<{ content: string; isError?: boolean }> {
    const runner = this.#claudeRunners.get(ref)?.get(call.name);
    if (!runner?.execute) {
      return {
        content: `${call.name} is not available on the Claude plan engine.`,
        isError: true,
      };
    }
    const args =
      call.input && typeof call.input === "object" && !Array.isArray(call.input)
        ? (call.input as Record<string, unknown>)
        : {};
    try {
      const result = await runner.execute(args, claudeToolApi(call.name), ctx);
      const text = (result.output ?? [])
        .map((block) => (typeof block.text === "string" ? block.text : ""))
        .filter(Boolean)
        .join("\n");
      return { content: text, ...(result.isError ? { isError: true } : {}) };
    } catch (error) {
      return { content: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  #setClaudeBusy(ref: ConversationRef, busy: boolean): void {
    if (busy) this.#claudeBusy.add(ref);
    else this.#claudeBusy.delete(ref);
    const was = this.#busy.has(ref);
    if (busy) this.#busy.add(ref);
    else this.#busy.delete(ref);
    if (was !== this.#busy.has(ref)) this.#emitActivity(this.#activity(ref));
  }

  #resolveModel(modelId: string): { provider: string; model: string } | undefined {
    return resolveModelId(
      modelId,
      this.provider,
      (provider, model) => this.#models.getModel(provider, model) !== undefined,
    );
  }

  // ── Conversations ─────────────────────────────────────────────────────

  async createConversation(config: BotAgentConfig): Promise<ConversationRef> {
    const { change, policy, claude } = this.#compile(config);
    const conversation = await this.#pi.harness.createConversation(
      { ownership: { kind: "ownerless" }, agent: change },
      ctx,
    );
    const ref = Number(conversation.id);
    if (policy) {
      await this.#pi.harness.commit(async (tx) => {
        applyPermissions(await tx.doc(PermissionsDoc, ref as ConversationId), policy.permissions);
      }, ctx);
    }
    this.#rememberClaude(ref, claude);
    if (claude) await this.#syncClaudeYolo(ref);
    return ref;
  }

  /**
   * Change persona, model and capabilities. Applies from the next model
   * request; history is kept.
   */
  async configure(ref: ConversationRef, config: BotAgentConfig): Promise<void> {
    const { change, policy, claude } = this.#compile(config);
    await this.#conversation(ref);
    await this.#pi.harness.commit(async (tx) => {
      await configureAgent(tx, ref as ConversationId, change);
      if (policy) {
        applyPermissions(await tx.doc(PermissionsDoc, ref as ConversationId), policy.permissions);
      }
    }, ctx);
    this.#rememberClaude(ref, claude);
    if (claude) await this.#syncClaudeYolo(ref);
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
   * returned.
   */
  async setYolo(
    ref: ConversationRef,
    on: boolean,
    by?: number,
  ): Promise<{ on: boolean; approved: number[] }> {
    await this.#conversation(ref);
    await this.#pi.harness.commit(async (tx) => {
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
    const approved = this.#claude.setYolo(
      ref,
      on ? { on, ...(by !== undefined ? { by } : {}) } : { on },
    );
    if (on && this.#approvals.count(ref) > 0) {
      const conversation = await this.#conversation(ref);
      const page = await conversation.entries(
        { order: "descending" },
        REVIEW_ENTRY_LOOKBACK,
        undefined,
        ctx,
      );
      if (ownerTurn(page.items, by)) {
        for (const taskId of this.#approvals.tasks(ref)) {
          try {
            await this.#pi.harness.commit((tx) => recordYoloDecision(tx, ref, taskId), ctx);
            approved.push(taskId);
          } catch {
            // Not an approval YOLO answers (a vault use, a question, a
            // credential request) or no longer waiting: it stays as it is.
          }
        }
      }
    }
    return { on, approved };
  }

  async #readYolo(ref: ConversationRef): Promise<{ on: boolean; by?: number }> {
    await this.#conversation(ref);
    return this.#pi.harness.commit(async (tx) => {
      const doc = await tx.doc(YoloDoc, ref as ConversationId);
      return doc.on ? { on: true, ...(doc.by !== undefined ? { by: doc.by } : {}) } : { on: false };
    }, ctx);
  }

  /** The Claude-plan engine keeps YOLO in memory: hand it the stored state. */
  async #syncClaudeYolo(ref: ConversationRef): Promise<void> {
    this.#claude.setYolo(ref, await this.#readYolo(ref));
  }

  /**
   * A bot's config as pi-durable stores it (the agent change) and as the
   * gate reads it (the permissions), compiled by `policy.ts`. Without a
   * capability selection the conversation keeps its tools.
   */
  #compile(config: BotAgentConfig): {
    change: AgentChange;
    policy?: CompiledPolicy;
    claude?: ClaudeSessionSync & { runners: Map<string, ClaudeToolRunner> };
  } {
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
      if (!config.capabilities) {
        return {
          change,
          claude: {
            model: bare,
            system: config.systemPrompt,
            tools: surface.tools,
            permissions: surface.permissions,
            vaultTools: surface.vaultTools,
            runners: surface.runners,
          },
        };
      }
      const policy = compilePolicy(
        this.#capabilities,
        config.capabilities,
        this.#registry.snapshot(),
      );
      return {
        change: { ...change, extensions: policy.extensions, tools: { remove: policy.remove } },
        policy,
        claude: {
          model: bare,
          system: config.systemPrompt,
          tools: surface.tools,
          permissions: surface.permissions,
          vaultTools: surface.vaultTools,
          runners: surface.runners,
        },
      };
    }
    const resolved = this.#resolveModel(config.modelId);
    if (!resolved) throw new ModelNotFoundError(config.modelId);
    const change: AgentChange = {
      model: { provider: resolved.provider, modelId: resolved.model },
      instructions: config.systemPrompt.trim() ? config.systemPrompt : null,
    };
    if (!config.capabilities) return { change, claude: undefined };
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
      policy,
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
      gateExtension(capability.extension, this.#approvals, this.#review, this.#yoloGate),
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
    if (this.#claude.ownsTask(taskId)) {
      this.#claude.decide(taskId, decision);
      return;
    }
    try {
      await this.#pi.harness.commit(
        (tx) => recordDecision(tx, ref, taskId, decision, options),
        ctx,
      );
    } catch (error) {
      approvalNotPending(error, taskId);
    }
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
      return await this.#pi.harness.commit((tx) => readPendingRequest(tx, taskId), ctx);
    } catch (error) {
      credentialRequestNotPending(error, taskId);
    }
  }

  /** Settle a credential request with the owner's outcome (never values). */
  async settleCredentialRequest(taskId: number, outcome: CredentialRequestOutcome): Promise<void> {
    try {
      await this.#pi.harness.commit((tx) => settleRequest(tx, taskId, outcome), ctx);
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
      await this.#pi.harness.commit((tx) => recordAnswers(tx, ref, taskId, answers), ctx);
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
      /** Who sent it, in a shared chat (`text` already carries their name for the model). */
      author?: ChatMessage["author"];
      /** Placement while a reply runs: "steer" joins it, "followUp" (default) waits. */
      whenBusy?: "steer" | "followUp";
    },
  ): Promise<void> {
    if (this.#claude.handles(ref)) {
      const outcome = await this.#claude.submit(ref, {
        requestId: input.requestId,
        text: input.text,
        images: input.images,
        ...(input.peer ? { peer: input.peer } : {}),
        ...(input.author ? { author: input.author } : {}),
      });
      if (outcome === "ran") return;
    }
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
        // Every user message records its request id on the entry, so a
        // client can confirm its Echo by id instead of by text.
        entry: {
          kind: CHAT_USER_ENTRY,
          data: {
            requestId: input.requestId,
            ...(input.peer ? { peer: input.peer } : {}),
            ...(input.author ? { author: { id: input.author.id, name: input.author.name } } : {}),
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
      },
      ctx,
    );
  }

  /** Stop the in-flight reply (and withdraw queued inputs). */
  async abort(ref: ConversationRef): Promise<void> {
    if (this.#claude.handles(ref)) {
      this.#claude.abort(ref);
      return;
    }
    const conversation = await this.#conversation(ref);
    await conversation.abort(ctx);
  }

  /**
   * Withdraw a message by its request id. A queued input leaves the inbox
   * (settling `unanswered`, reason `aborted`); a placed one is already part
   * of the running reply, and a settled one is done.
   */
  async withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    const record = await this.#pi.harness.commit(
      (tx) => tx.submissionByRequest(ref as ConversationId, requestId),
      ctx,
    );
    // Writes (compaction summaries) and unknown ids are not owner messages.
    if (!record || record.type !== "input") return "not_found";
    if (record.status === "queued") {
      const result = await this.#pi.harness.abortSubmission(record.id, ctx, ref as ConversationId);
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
    if (this.#claude.handles(ref)) {
      const state = await this.#claude.read(ref);
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const message = state.messages[i];
        if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
        const text = message.error ? `⚠ ${message.error}` : message.text;
        if (!text) continue;
        return { role: message.role, text, createdAt: message.createdAt };
      }
      return undefined;
    }
    const conversation = await this.#conversation(ref);
    const page = await conversation.entries({ order: "descending" }, 20, undefined, ctx);
    for (const entry of page.items) {
      const message = entry.model?.[0];
      if (!message) continue;
      if ((entry.kind === "pi.user" || entry.kind === CHAT_USER_ENTRY) && message.role === "user") {
        return {
          role: "user",
          text: textOf(message.content),
          createdAt: message.timestamp ?? Date.now(),
        };
      }
      if (entry.kind === "pi.assistant" && message.role === "assistant") {
        const shown =
          message.stopReason === "error" ? `⚠ ${modelErrorText(message)}` : textOf(message.content);
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
    return state.messages.flatMap((message) => finishedReplyOf(message) ?? []);
  }

  /**
   * The conversation's chat state right now, for one-shot readers (Settled,
   * Deliveries, Routine runs, memory capture, history) that need the
   * transcript but no stream. An idle conversation is read from the store
   * alone (no watch opened); a busy one through a watch, so its in-flight
   * reply and tool round show as the stream would show them.
   */
  async readChat(ref: ConversationRef): Promise<ChatState> {
    if (this.#claude.handles(ref)) return this.#claude.read(ref);
    const conversation = await this.#conversation(ref);
    if (this.isBusy(ref)) {
      const subscription = await this.watchChat(ref, () => undefined);
      await subscription.stop();
      return subscription.initial;
    }
    const projection = new ChatProjection(
      await this.#snapshot(conversation, ref, { entries: [], busy: false, tools: [] }),
    );
    return projection.state;
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
    if (this.#claude.handles(ref)) return this.#claude.page(ref, before, limit);
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
   * The fold itself is `ChatProjection`'s; this method is its event source.
   */
  async watchChat(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number } = {},
  ): Promise<ChatSubscription> {
    if (this.#claude.handles(ref)) return this.#claude.watch(ref, listener, options.window);
    const conversation = await this.#conversation(ref);
    const stream = await watchEvents(this.#pi.harness, ref as ConversationId, ctx);
    const projection = new ChatProjection(
      await this.#snapshot(conversation, ref, stream.snapshot),
      options,
    );
    const initial = projection.state;
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

    await listener([{ type: "snapshot", state: initial }]);

    stream.start(async (events) => {
      if (stopped) return;
      const outcome = projection.fold(events);
      if (outcome.resnapshot) {
        const fresh = events.findLast((event) => event.type === "snapshot");
        if (fresh && fresh.type === "snapshot") {
          projection.reset(await this.#snapshot(conversation, ref, fresh));
        }
      } else if (outcome.inboxChanged) {
        // The inbox doc moved (send while busy, placement, withdrawal); the
        // items' content lives in the doc, not the event.
        projection.setQueued(await this.#queued(ref));
      }
      const diff = projection.flush({ resnapshot: outcome.resnapshot });
      if (diff.length > 0) await listener(diff);
    });

    return subscription;
  }

  /**
   * Everything a projection starts from: the full stored history (not just
   * what the model still sees), the stream's view of the in-flight reply
   * and tool round, the queue, and the unanswered reasons recorded on the
   * conversation's submissions (so they survive a reconnect and show in a
   * one-shot read, not only after a live `submission` event).
   */
  async #snapshot(
    conversation: Conversation,
    ref: ConversationRef,
    live: {
      entries: readonly EntryRecord[];
      generation?: { message?: ProjectionSnapshot["live"] };
      run?: unknown;
      busy?: boolean;
      tools: ProjectionSnapshot["tools"];
    },
  ): Promise<ProjectionSnapshot> {
    const entries = new Map<number, EntryRecord>();
    for (const entry of await loadHistory(conversation)) entries.set(Number(entry.id), entry);
    for (const entry of live.entries) entries.set(Number(entry.id), entry);
    const inspection = await this.#pi.harness.inspect(ctx);
    const records = inspection.submissions.filter(
      (record) => Number(record.conversationId) === ref,
    );
    const inbox = await this.#pi.harness.snapshot(InboxDoc, ref as ConversationId, ctx);
    const items = inbox?.items ?? [];
    return {
      entries: [...entries.values()],
      live: live.generation?.message,
      busy: live.busy ?? live.run !== undefined,
      tools: live.tools,
      queued:
        items.length === 0
          ? []
          : queuedOf(items, new Map(records.map((record) => [String(record.id), record]))),
      unanswered: unansweredOf(records),
    };
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
    const graph = await this.#pi.harness.watchTaskGraph(ctx);
    this.#graph = graph;
    this.#busy = busyFromGraph(graph.value);
    graph.start(async (value) => {
      const next = busyFromGraph(value);
      for (const ref of this.#claudeBusy) next.add(ref);
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
    await this.#claude.close().catch(() => undefined);
    try {
      await this.#pi.harness.close(ctx);
    } finally {
      this.#lock?.release();
    }
  }

  /**
   * The conversation's queued owner messages from `pi.inbox`. The inbox doc
   * holds the items; the submission records (via `inspect()`) supply the
   * request ids withdrawal addresses. Both reads are plain snapshots, newer
   * than any event that triggered the refresh.
   */
  async #queued(ref: ConversationRef): Promise<QueuedMessage[]> {
    const inbox = await this.#pi.harness.snapshot(InboxDoc, ref as ConversationId, ctx);
    const items = inbox?.items ?? [];
    if (items.length === 0) return [];
    const inspection = await this.#pi.harness.inspect(ctx);
    const records = new Map(
      inspection.submissions
        .filter((record) => Number(record.conversationId) === ref)
        .map((record) => [String(record.id), record]),
    );
    return queuedOf(items, records);
  }

  async #conversation(ref: ConversationRef): Promise<Conversation> {
    const conversation = await this.#pi.harness.conversation(ref as ConversationId, ctx);
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
