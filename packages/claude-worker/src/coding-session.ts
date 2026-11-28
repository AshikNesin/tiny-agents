import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { assertSessionMayStart, type ClaudeAuthStatus } from "./auth";
import { AppToolCalls, appServers, appToolName, type AppToolOutcome } from "./coding-app-tools";
import { approvalOf, CodingApprovals } from "./coding-approvals";
import { CodingError } from "./coding-error";
import { InputQueue, type HeldMessage, type InputItem } from "./coding-input";
import {
  newTurn,
  noticeEntry,
  resetsAtOf,
  resultEntry,
  stoppedEarlyError,
  syntheticResultEntry,
  type TurnState,
} from "./coding-turn";
import { UsageMeter } from "./coding-usage";
import { warnFailure, warnedAs } from "./failures";
import {
  DEFAULT_CODING_PERMISSION_MODE,
  promptWithAttachments,
  type CodingAnswer,
  type CodingAttachment,
  type CodingEvent,
  type CodingLimits,
  type CodingQueued,
  type CodingSendResult,
  type CodingSessionConfig,
  type CodingSettingsChange,
  type CodingSettingsResult,
  type CodingState,
  type CodingToolSpec,
} from "./coding-protocol";
import {
  buildCodingSdkOptions,
  type CodingCanUseTool,
  type CodingPermissionResult,
  type CodingQuery,
  type CodingSdk,
  type CodingSdkMessage,
  type CodingSdkUserMessage,
} from "./coding-sdk";
import type { SdkToolResult } from "./sdk";
import { SessionLog } from "./session-log";
import { writeSkillsPlugin } from "./coding-skills";
import { asRateLimitInfo, usagePauseReason } from "./usage";
import { record } from "@tiny-agents/std";

export interface CodingDeps {
  sdk: CodingSdk;
  home?: string;
  env: Record<string, string | undefined>;
  limits: CodingLimits;
  authStatus: () => Promise<ClaudeAuthStatus>;
  now: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

const MAX_SENT_UUIDS = 200;

export interface CodingPartial {
  reset?: boolean;
  text?: string;
  thinking?: string;
}

export interface CodingSessionHost {
  checkTurnSlot(session: CodingSession): void;
  reserveProcess(session: CodingSession): void;
  fetchCatalog(query: CodingQuery): Promise<void>;
  onPartial: ((sessionId: string, partial: CodingPartial) => void) | undefined;
}

export class CodingSession {
  readonly id: string;
  config: CodingSessionConfig;
  claudeSessionId: string | undefined;
  running = false;
  live = false;
  starting = false;
  lastUsed: number;
  readonly log: SessionLog<CodingEvent>;

  private query: CodingQuery | undefined;
  private input: InputQueue | undefined;
  private generation = 0;
  private initialized = false;
  private turn: TurnState | undefined;
  private readonly queue: HeldMessage[] = [];
  private readonly approvals = new CodingApprovals((event) => this.publish(event));
  private readonly calls = new AppToolCalls(
    (event) => this.publish(event),
    (fn, ms) => (this.deps.schedule ?? defaultSchedule)(fn, ms),
  );
  private readonly sent = new Map<string, CodingSendResult>();
  private readonly meter = new UsageMeter();
  private bypassAllowed = false;
  private restartWhenIdle = false;
  private lastEntryUuid: string | undefined;
  private stderrTail = "";

  constructor(
    id: string,
    config: CodingSessionConfig,
    private readonly book: CodingSessionHost,
    private readonly deps: CodingDeps,
  ) {
    this.id = id;
    this.config = { ...config };
    this.claudeSessionId = config.resume;
    this.lastUsed = deps.now();
    this.log = new SessionLog(id, deps.limits.eventBuffer);
  }

  get busy(): boolean {
    return this.running || this.approvals.size > 0 || this.queue.length > 0;
  }

  configure(config: CodingSessionConfig): void {
    if (this.live || this.starting) return;
    this.config = { ...this.config, ...config };
    if (config.resume && !this.claudeSessionId) this.claudeSessionId = config.resume;
  }

  state(): CodingState {
    return {
      running: this.running,
      live: this.live,
      ...(this.claudeSessionId ? { claudeSessionId: this.claudeSessionId } : {}),
      queued: this.queue.map((item): CodingQueued => ({
        id: item.id,
        text: item.text,
        createdAt: item.createdAt,
      })),
      settings: {
        model: this.config.model ?? null,
        effort: this.config.effort ?? null,
        permissionMode: this.config.permissionMode ?? DEFAULT_CODING_PERMISSION_MODE,
      },
    };
  }

  async send(input: {
    uuid: string;
    text: string;
    mode: "steer" | "queue";
    attachments?: CodingAttachment[];
  }): Promise<CodingSendResult> {
    const cached = this.sent.get(input.uuid);
    if (cached) return cached;
    this.lastUsed = this.deps.now();
    const held: HeldMessage = {
      id: `q_${randomBytes(6).toString("hex")}`,
      uuid: input.uuid,
      text: input.text,
      attachments: input.attachments ?? [],
      createdAt: new Date(this.deps.now()).toISOString(),
    };
    let result: CodingSendResult;
    if (!this.running) {
      await this.startTurn(held);
      result = { status: "accepted" };
    } else if (input.mode === "steer" && this.live) {
      this.pushInput(held, "next");
      result = { status: "accepted" };
    } else {
      this.queue.push(held);
      this.emitState();
      result = { status: "queued", queuedId: held.id };
    }
    this.remember(input.uuid, result);
    return result;
  }

  interrupt(): { stopped: boolean } {
    this.lastUsed = this.deps.now();
    const turn = this.turn;
    if (!this.running || !turn) return { stopped: false };
    if (turn.stopRequested) return { stopped: true };
    turn.stopRequested = true;
    this.approvals.closeAll(
      { behavior: "deny", message: "Stopped by the user.", interrupt: true },
      "expired",
    );
    if (turn.firstInput && !turn.firstInput.taken && this.input?.remove(turn.firstInput)) {
      this.endTurnSynthetic({ interrupted: true });
      return { stopped: true };
    }
    turn.stopBeforeActivity = !turn.activity;
    this.sendInterrupt();
    const schedule = this.deps.schedule ?? defaultSchedule;
    turn.cancelStopTimer = schedule(() => {
      if (this.turn !== turn || !this.running) return;
      this.closeProcess("Claude Code did not stop in time; its process was closed.");
    }, this.deps.limits.stopGraceMs);
    return { stopped: true };
  }

  respond(approvalId: string, answer: CodingAnswer): void {
    this.lastUsed = this.deps.now();
    this.approvals.respond(approvalId, answer);
  }

  async settings(change: CodingSettingsChange): Promise<CodingSettingsResult> {
    this.lastUsed = this.deps.now();
    let applied: CodingSettingsResult["applied"] = this.live ? "live" : "stored";
    const query = this.live ? this.query : undefined;
    if (change.model !== undefined) {
      this.config.model = change.model;
      if (query) await query.setModel(change.model ?? undefined);
    }
    if (change.effort !== undefined) {
      this.config.effort = change.effort;
      if (query) {
        if (query.applyFlagSettings) {
          await query.applyFlagSettings({ effortLevel: change.effort ?? null });
        } else {
          this.restartWhenIdle = true;
          applied = "next_process";
        }
      }
    }
    if (change.permissionMode !== undefined) {
      this.config.permissionMode = change.permissionMode;
      const mode = change.permissionMode ?? DEFAULT_CODING_PERMISSION_MODE;
      if (query) {
        if (mode === "bypassPermissions" && !this.bypassAllowed) {
          this.restartWhenIdle = true;
          applied = "next_process";
        } else {
          await query.setPermissionMode(mode);
        }
      }
    }
    if (this.restartWhenIdle && !this.running && this.live) {
      this.closeProcess();
    }
    this.emitState();
    return { settings: this.state().settings, applied };
  }

  async manageQueue(action: "send" | "cancel", queuedId: string): Promise<void> {
    this.lastUsed = this.deps.now();
    const index = this.queue.findIndex((item) => item.id === queuedId);
    if (index < 0) throw new CodingError("not_found", "That queued message is gone.");
    const [held] = this.queue.splice(index, 1);
    if (!held) return;
    if (action === "cancel") {
      this.emitState();
      return;
    }
    if (this.running && this.live) {
      this.pushInput(held, "next");
      this.emitState();
      return;
    }
    try {
      await this.startTurn(held);
    } catch (error) {
      this.queue.splice(index, 0, held);
      this.emitState();
      throw error;
    }
  }

  close(): void {
    this.queue.length = 0;
    if (this.live || this.starting) this.closeProcess();
    else this.emitState();
  }

  private async startTurn(held: HeldMessage): Promise<void> {
    this.book.checkTurnSlot(this);
    this.running = true;
    this.turn = newTurn(this.deps.now(), false);
    try {
      if (!this.live) await this.startProcess();
    } catch (error) {
      this.running = false;
      this.turn = undefined;
      this.emitState();
      throw error;
    }
    const item = this.pushInput(held);
    if (this.turn) this.turn.firstInput = item;
    this.emitState();
  }

  private async startProcess(): Promise<void> {
    this.book.reserveProcess(this);
    this.starting = true;
    try {
      await assertSessionMayStart(this.deps.env, this.deps.authStatus);
      const generation = ++this.generation;
      const input = new InputQueue();
      const canUseTool: CodingCanUseTool = (name, toolInput, options) =>
        this.canUseTool(generation, name, toolInput, options);
      const skillsPlugin = await this.skillsPlugin();
      const options = buildCodingSdkOptions({
        cwd: this.config.cwd,
        resume: this.claudeSessionId ?? this.config.resume,
        model: this.config.model,
        effort: this.config.effort,
        permissionMode: this.config.permissionMode,
        env: this.deps.env,
        canUseTool,
        stderr: (data) => {
          this.stderrTail = (this.stderrTail + data).slice(-2_000);
        },
        ...this.appServers(generation),
        ...(skillsPlugin ? { skillsPlugin } : {}),
      });
      const query = this.deps.sdk.query({ prompt: input.iterate(), options });
      this.query = query;
      this.input = input;
      this.live = true;
      this.initialized = false;
      this.bypassAllowed = options.permissionMode === "bypassPermissions";
      this.restartWhenIdle = false;
      this.meter.reset();
      this.stderrTail = "";
      void this.consume(query, generation);
    } finally {
      this.starting = false;
    }
  }

  private async consume(query: CodingQuery, generation: number): Promise<void> {
    let failure: unknown;
    try {
      for await (const message of query) {
        if (generation !== this.generation) return;
        this.onSdkMessage(message);
      }
    } catch (error) {
      failure = error;
    }
    if (generation !== this.generation) return;
    this.processEnded(failure);
  }

  private processEnded(failure: unknown): void {
    this.generation += 1;
    this.live = false;
    this.query = undefined;
    this.input?.close();
    this.input = undefined;
    this.expireApprovals();
    if (this.running) {
      this.endTurnSynthetic({ error: stoppedEarlyError(failure, this.stderrTail) });
    } else {
      this.emitState();
    }
  }

  private closeProcess(error?: string): void {
    const query = this.query;
    this.generation += 1;
    this.live = false;
    this.query = undefined;
    this.input?.close();
    this.input = undefined;
    this.expireApprovals();
    try {
      query?.close();
    } catch (closeError) {
      warnFailure(`closing the Claude Code process of session ${this.id}`, closeError);
    }
    if (this.running) {
      this.endTurnSynthetic(error ? { error } : { interrupted: true });
    } else {
      this.emitState();
    }
  }

  private sendInterrupt(): void {
    void this.query
      ?.interrupt()
      .catch(warnedAs(`interrupting the turn of session ${this.id}`, undefined));
  }

  private pushInput(held: HeldMessage, priority?: "next"): InputItem {
    const content = promptWithAttachments(held.text, held.attachments);
    const message: CodingSdkUserMessage = {
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
      session_id: this.claudeSessionId ?? "",
      uuid: held.uuid,
      ...(priority ? { priority } : {}),
    };
    const item: InputItem = { message, taken: false };
    this.lastEntryUuid = held.uuid;
    this.publish({
      type: "message",
      message: {
        type: "user",
        uuid: held.uuid,
        session_id: this.claudeSessionId ?? "",
        parent_tool_use_id: null,
        message: { role: "user", content },
        ...(priority ? { priority } : {}),
        timestamp: new Date(this.deps.now()).toISOString(),
      },
    });
    this.input?.push(item);
    return item;
  }

  private onSdkMessage(message: CodingSdkMessage): void {
    this.lastUsed = this.deps.now();
    const type = message.type;
    const main = message.parent_tool_use_id == null;
    const output = type === "assistant" || type === "stream_event" || type === "user";
    if (output && main) this.noteActivity();

    if (type === "system") {
      this.onSystem(message);
      return;
    }
    if (type === "stream_event") {
      if (main) this.onStreamEvent(message);
      return;
    }
    if (type === "rate_limit_event") {
      const info = asRateLimitInfo(message.rate_limit_info);
      const reason = usagePauseReason(info);
      if (reason && this.turn && !this.turn.usageLimit) {
        this.turn.usageLimit = { reason, ...resetsAtOf(info?.resetsAt) };
        if (!this.turn.stopRequested) {
          this.turn.stopRequested = true;
          this.sendInterrupt();
        }
      }
      return;
    }
    if (type === "result") {
      this.onResult(message);
      return;
    }
    if (type === "assistant" || type === "user") {
      if (!main) return;
      if (type === "assistant" && this.turn && !this.turn.usageLimit) {
        const error = message.error;
        if (error === "rate_limit" || error === "billing_error") {
          this.turn.usageLimit = { reason: String(error) };
        }
      }
      if (typeof message.uuid === "string") this.lastEntryUuid = message.uuid;
      this.partial({ reset: true });
      this.publish({ type: "message", message });
    }
  }

  private onSystem(message: CodingSdkMessage): void {
    if (message.subtype === "init") {
      this.initialized = true;
      const id = typeof message.session_id === "string" ? message.session_id : undefined;
      if (id && id !== this.claudeSessionId) {
        this.claudeSessionId = id;
        this.config.resume = id;
      }
      this.emitState();
      const query = this.query;
      if (query) void this.book.fetchCatalog(query);
      return;
    }
    if (message.subtype === "status") {
      const mode = message.permissionMode;
      if (typeof mode === "string" && isCodingMode(mode) && mode !== this.config.permissionMode) {
        this.config.permissionMode = mode;
        this.emitState();
      }
      return;
    }
    if (message.subtype === "compact_boundary") {
      if (typeof message.uuid === "string") this.lastEntryUuid = message.uuid;
      this.publish({ type: "message", message });
    }
  }

  private onStreamEvent(message: CodingSdkMessage): void {
    const event = record(message.event);
    if (!event) return;
    if (event.type === "message_start") {
      this.partial({ reset: true });
      return;
    }
    if (event.type !== "content_block_delta") return;
    const delta = record(event.delta);
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      this.partial({ text: delta.text });
    } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
      this.partial({ thinking: delta.thinking });
    }
  }

  private noteActivity(): void {
    if (!this.running) {
      this.running = true;
      this.turn = newTurn(this.deps.now(), true);
      this.emitState();
      return;
    }
    const turn = this.turn;
    if (!turn || turn.activity) return;
    turn.activity = true;
    if (turn.stopRequested && turn.stopBeforeActivity) {
      turn.stopBeforeActivity = false;
      this.sendInterrupt();
    }
  }

  private onResult(message: CodingSdkMessage): void {
    const turn = this.turn;
    const total = typeof message.total_cost_usd === "number" ? message.total_cost_usd : 0;
    const turnCost = this.meter.turnCost(total);
    const usage = record(message.modelUsage);
    const turnUsage = usage ? this.meter.delta(usage) : undefined;
    this.publish({
      type: "message",
      message: resultEntry(message, turn, {
        turnCost,
        turnUsage,
        afterUuid: this.lastEntryUuid,
        now: () => this.deps.now(),
      }),
    });
    this.lastEntryUuid = typeof message.uuid === "string" ? message.uuid : this.lastEntryUuid;
    turn?.cancelStopTimer?.();
    const more = typeof message.queued_turn_count === "number" && message.queued_turn_count > 0;
    const stopped = !!turn?.stopRequested;
    this.afterTurn(more, stopped);
  }

  private afterTurn(more: boolean, stopped: boolean): void {
    if (more && this.live) {
      this.turn = newTurn(this.deps.now(), false);
    } else {
      this.running = false;
      this.turn = undefined;
    }
    if (!this.running && this.restartWhenIdle && this.live) {
      this.closeProcess();
    } else {
      this.emitState();
    }
    if (!this.running && !stopped && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.startTurn(next).catch((error: unknown) => {
        this.queue.unshift(next);
        this.publishNotice(error instanceof Error ? error.message : String(error));
        this.emitState();
      });
    }
  }

  private endTurnSynthetic(outcome: { error?: string; interrupted?: boolean }): void {
    const turn = this.turn;
    turn?.cancelStopTimer?.();
    const uuid = randomUUID();
    this.publish({
      type: "message",
      message: syntheticResultEntry(outcome, turn, {
        uuid,
        sessionId: this.claudeSessionId ?? "",
        totalCost: this.meter.cost,
        afterUuid: this.lastEntryUuid,
        now: () => this.deps.now(),
      }),
    });
    this.lastEntryUuid = uuid;
    this.running = false;
    this.turn = undefined;
    if (this.restartWhenIdle && this.live) this.closeProcess();
    else this.emitState();
  }

  private publishNotice(text: string): void {
    this.publish({
      type: "message",
      message: noticeEntry(randomUUID(), this.claudeSessionId ?? "", text),
    });
  }

  private canUseTool(
    generation: number,
    toolName: string,
    input: Record<string, unknown>,
    options: Parameters<CodingCanUseTool>[2],
  ): Promise<CodingPermissionResult> {
    if (generation !== this.generation || options.signal.aborted) {
      return Promise.resolve({
        behavior: "deny",
        message: "The session stopped.",
        interrupt: true,
      });
    }
    if (this.turn?.stopRequested) {
      return Promise.resolve({
        behavior: "deny",
        message: "Stopped by the user.",
        interrupt: true,
      });
    }
    const approvalId = `apr_${randomBytes(8).toString("hex")}`;
    const approval = approvalOf(approvalId, toolName, input, options);
    return this.approvals.open(approval, options.signal);
  }

  settleCall(callId: string, outcome: AppToolOutcome): boolean {
    return this.calls.settle(callId, outcome);
  }

  private async skillsPlugin(): Promise<string | undefined> {
    const root = path.join(
      this.deps.home ?? homedir(),
      ".tiny-agents",
      "code-skills",
      this.id.replace(/[^\w-]/g, "_"),
    );
    const skills = this.config.skills ?? [];
    if (skills.length === 0) return undefined;
    await writeSkillsPlugin(root, skills);
    return root;
  }

  private appServers(generation: number): {
    mcpServers?: Record<string, unknown>;
    allowedTools?: string[];
  } {
    return appServers(this.config.tools ?? [], this.deps.sdk, (spec, args) =>
      this.callAppTool(generation, spec, args),
    );
  }

  private async callAppTool(
    generation: number,
    spec: CodingToolSpec,
    input: Record<string, unknown>,
  ): Promise<SdkToolResult> {
    if (spec.ask) {
      const decision = await this.canUseTool(generation, appToolName(spec), input, {
        signal: new AbortController().signal,
        toolUseID: "",
      });
      if (decision.behavior === "deny") {
        return { content: [{ type: "text", text: decision.message }], isError: true };
      }
    }
    const outcome = await this.calls.call(spec, input);
    return {
      content: [{ type: "text", text: outcome.content }],
      ...(outcome.isError ? { isError: true } : {}),
    };
  }

  private expireApprovals(): void {
    this.approvals.closeAll({ behavior: "deny", message: "The session stopped." }, "expired");
    this.calls.closeAll({ content: "The session stopped.", isError: true });
  }

  private emitState(): void {
    this.publish({ type: "state", state: this.state() });
  }

  private publish(event: CodingEvent): void {
    this.log.append(event);
  }

  private partial(partial: CodingPartial): void {
    this.book.onPartial?.(this.id, partial);
  }

  private remember(uuid: string, result: CodingSendResult): void {
    this.sent.set(uuid, result);
    if (this.sent.size > MAX_SENT_UUIDS) {
      const oldest = this.sent.keys().next().value;
      if (oldest) this.sent.delete(oldest);
    }
  }
}

function isCodingMode(mode: string): mode is NonNullable<CodingSessionConfig["permissionMode"]> {
  return (
    mode === "default" || mode === "acceptEdits" || mode === "plan" || mode === "bypassPermissions"
  );
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}
