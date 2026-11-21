import type { Context } from "@earendil-works/chord/context";
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
  type Report,
  type Storage,
} from "@earendil-works/pi-durable";
import type { ImageProcessor } from "@earendil-works/pi-durable/tools";
import { createFitImagesExtension } from "@earendil-works/pi-durable/images/fit";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
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
import { WaitTracker, type WaitTransition } from "./waiting";
import type { Reviewer } from "./reviewer";
import { GrantsDoc } from "./vault";
import type { ConversationTrace, ConversationUsage } from "./trace";

export { ApprovalNotPendingError, CredentialRequestNotPendingError, QuestionNotPendingError };

const ctx: Context = BACKGROUND_CONTEXT;

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
  storePath: string;
  modelConfig?: ModelConfig;
  credentials?: CredentialResolver;
  models?: MutableModels;
  lockWaitMs?: number;
  settings?: HarnessSettings;
  capabilities?: readonly Capability[];
  approvalTracker?: WaitTracker;
  reviewer?: Reviewer;
  ownerUserId?: () => Promise<number | undefined>;
  extensions?: readonly Extension[];
  onReport?: (error: unknown) => void;
  onFatal?: (error: unknown) => void;
  claudeWorker?: ClaudeWorkerLocator;
  claudeConnect?: (url: string, token: string) => WebSocketLike;
  images?: ImageProcessor;
}

export class AgentRuntime {
  readonly #store: ConversationStore;
  readonly #pi: AgentEngine;
  readonly #claude: AgentEngine;
  readonly #engines: readonly AgentEngine[];
  readonly #gate: ToolGate;
  readonly #models: MutableModels;
  #catalog: ModelCatalog;
  #credentials: CredentialResolver;
  #built = new Set<string>();
  readonly #lock: StoreLock | undefined;
  readonly #activityListeners = new Set<(change: ActivityChange) => void>();
  readonly #registry: Registry;
  readonly #approvals: WaitTracker;
  readonly #questions: WaitTracker;
  readonly #capabilities = new Map<string, Capability>();
  #busy = new Set<ConversationRef>();
  #closed = false;

  get models(): MutableModels {
    return this.#models;
  }

  get catalog(): ModelCatalog {
    return this.#catalog;
  }

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
    images: ImageProcessor,
    legacyPath?: string,
    claudeWorker?: ClaudeWorkerLocator,
    claudeConnect?: (url: string, token: string) => WebSocketLike,
    onReport?: (error: unknown) => void,
  ) {
    this.#store = new ConversationStore(harness, {
      onReplying: (ref) => this.#busyChanged(ref),
    });
    this.#gate = gate;
    this.#pi = new PiEngine(this.#store, images);
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
    questions.onTransition((transition) => {
      if (transition.change === "added") {
        void this.#dismissIfOwnerWrote(transition).catch((error: unknown) => onReport?.(error));
      }
    });
  }

  async #dismissIfOwnerWrote({ conversation, task }: WaitTransition): Promise<void> {
    const { queued } = await this.readChat(conversation);
    if (queued.length === 0) return;
    try {
      await this.answerQuestions(conversation, task, null);
    } catch (error) {
      if (!(error instanceof QuestionNotPendingError)) throw error;
    }
  }

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
      const initial = buildProviders(options.modelConfig ?? EMPTY_MODEL_CONFIG, credentials);
      for (const provider of initial) models.setProvider(provider);
      const registry = createRegistry();
      const approvals = options.approvalTracker ?? new WaitTracker();
      const questions = new WaitTracker();
      const capabilities = [
        ...(options.capabilities ?? []),
        createQuestionsCapability(questions),
        createToolSearchCapability((id) => runtime?.capabilityInfo(id)),
      ];
      const images = options.images ?? (await createNodePhotonImages());
      registry.install(createFitImagesExtension(images));
      registry.install(createContextTrimExtension());
      for (const extension of options.extensions ?? []) registry.install(extension);
      const gate = new ToolGate({
        approvals,
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
            followUpMode: "all",
            ...options.settings,
            compaction: withContextCeiling(models, {
              enabled: true,
              ...options.settings?.compaction,
            }),
          },
          ...(options.onReport
            ? { onReport: (report: Report) => options.onReport?.(report.error) }
            : {}),
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
        images,
        inMemory ? undefined : `${options.storePath}.claude.json`,
        options.claudeWorker,
        options.claudeConnect,
        options.onReport,
      );
      opened.applyModelConfig(options.modelConfig ?? EMPTY_MODEL_CONFIG);
      runtime = opened;
      pi = opened.#pi;
      harness.closed.then((end) => {
        if (end.kind === "failed" && !opened.#closed) options.onFatal?.(end.error);
      });
      await opened.#store.start();
      for (const engine of opened.#engines) await engine.start();
      opened.#busy = new Set(opened.#store.replyingConversations());
      opened.#store.resume();
      return opened;
    } catch (error) {
      if (runtime) runtime.#closed = true;
      await (harness ? harness.close(ctx) : storage?.close(ctx))?.catch(() => undefined);
      lock?.release();
      throw error;
    }
  }

  #engineFor(ref: ConversationRef): AgentEngine {
    return this.#claude.runs(ref) ? this.#claude : this.#pi;
  }

  async #configureEngines(ref: ConversationRef, compiled: CompiledConversation): Promise<void> {
    for (const engine of this.#engines) await engine.configure(ref, compiled);
  }

  #busyChanged(ref: ConversationRef): void {
    const was = this.#busy.has(ref);
    const now = this.#engines.some((engine) => engine.busy(ref));
    if (now) this.#busy.add(ref);
    else this.#busy.delete(ref);
    if (was !== now) this.#emitActivity(this.#activity(ref));
  }

  async createConversation(config: BotAgentConfig): Promise<ConversationRef> {
    const compiled = this.#compile(config);
    const ref = await this.#store.create(compiled);
    await this.#configureEngines(ref, compiled);
    return ref;
  }

  async configure(ref: ConversationRef, config: BotAgentConfig): Promise<void> {
    const compiled = this.#compile(config);
    await this.#store.configure(ref, compiled);
    await this.#configureEngines(ref, compiled);
  }

  usedTokens(ref: ConversationRef): Promise<number> {
    return this.#store.usedTokens(ref);
  }

  usage(ref: ConversationRef): Promise<ConversationUsage> {
    return this.#store.usage(ref);
  }

  trace(ref: ConversationRef): Promise<ConversationTrace> {
    return this.#store.trace(ref);
  }

  async yolo(ref: ConversationRef): Promise<boolean> {
    return (await this.#store.yolo(ref)).on;
  }

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
        extensions: policy.extensions,
        tools: { remove: policy.remove },
      },
      permissions: policy.permissions,
    };
  }

  listCapabilities(): CapabilityInfo[] {
    return [...this.#capabilities.values()].map(capabilityInfo);
  }

  capabilityInfo(id: string): CapabilityInfo | undefined {
    const capability = this.#capabilities.get(id);
    return capability ? capabilityInfo(capability) : undefined;
  }

  installCapability(capability: Capability): void {
    this.#capabilities.set(capability.id, capability);
    this.#registry.install(
      gateExtension(capability.extension, this.#gate, (id) => this.#pi.userMessages(id)),
    );
  }

  uninstallCapability(id: string): void {
    const extension = this.#registry.snapshot().extension(id);
    this.#capabilities.delete(id);
    if (extension) this.#registry.uninstall(extension);
  }

  pendingApprovals(ref: ConversationRef): number {
    return this.#gate.waiting(ref);
  }

  attachmentIds(ref: ConversationRef): Promise<string[]> {
    return this.#store.attachmentIds(ref);
  }

  async decideApproval(
    ref: ConversationRef,
    taskId: number,
    decision: ApprovalDecision,
    options: { grant?: boolean } = {},
  ): Promise<void> {
    await this.#gate.decide(ref, taskId, decision, options);
  }

  async credentialRequest(
    taskId: number,
  ): Promise<{ conversation: ConversationRef; request: CredentialRequest; expiresAt: number }> {
    try {
      return await this.#store.harness.commit((tx) => readPendingRequest(tx, taskId), ctx);
    } catch (error) {
      credentialRequestNotPending(error, taskId);
    }
  }

  async settleCredentialRequest(taskId: number, outcome: CredentialRequestOutcome): Promise<void> {
    try {
      await this.#store.harness.commit((tx) => settleRequest(tx, taskId, outcome), ctx);
    } catch (error) {
      credentialRequestNotPending(error, taskId);
    }
  }

  pendingQuestions(ref: ConversationRef): number {
    return this.#questions.count(ref);
  }

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

  async dismissQuestions(ref: ConversationRef): Promise<void> {
    for (const taskId of this.#questions.tasks(ref)) {
      try {
        await this.answerQuestions(ref, taskId, null);
      } catch (error) {
        if (!(error instanceof QuestionNotPendingError)) throw error;
      }
    }
  }

  async submit(ref: ConversationRef, input: EngineSubmission): Promise<void> {
    const engine = this.#engineFor(ref);
    if ((await engine.submit(ref, input)) === "accepted") return;
    await this.#pi.submit(ref, input);
  }

  async abort(ref: ConversationRef): Promise<void> {
    await this.#engineFor(ref).abort(ref);
  }

  withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    return this.#engineFor(ref).withdraw(ref, requestId);
  }

  isBusy(ref: ConversationRef): boolean {
    return this.#busy.has(ref);
  }

  busyConversations(): ConversationRef[] {
    return [...this.#busy];
  }

  async lastMessage(ref: ConversationRef): Promise<LastMessage | undefined> {
    return lastMessageOf((await this.readChat(ref)).messages);
  }

  async finishedReplies(ref: ConversationRef): Promise<FinishedReply[]> {
    const state = await this.readChat(ref);
    if (state.busy) return [];
    return state.messages.flatMap((message) => finishedReplyOf(message) ?? []);
  }

  readChat(ref: ConversationRef): Promise<ChatState> {
    return this.#engineFor(ref).read(ref);
  }

  async readChatPage(
    ref: ConversationRef,
    { before, limit }: { before: string; limit: number },
  ): Promise<ChatPage | undefined> {
    return pageBefore((await this.readChat(ref)).messages, before, limit);
  }

  watchChat(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    options: { window?: number } = {},
  ): Promise<ChatSubscription> {
    return this.#engineFor(ref).watch(ref, listener, options);
  }

  onActivity(listener: (change: ActivityChange) => void): () => void {
    this.#activityListeners.add(listener);
    return () => this.#activityListeners.delete(listener);
  }

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
      } catch {}
    }
  }

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
