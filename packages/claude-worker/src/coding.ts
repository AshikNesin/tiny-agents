import { randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { assertSessionMayStart, type ClaudeAuthStatus } from "./auth";
import {
  DEFAULT_CODING_PERMISSION_MODE,
  promptWithAttachments,
  type CodingAnswer,
  type CodingApproval,
  type CodingAttachment,
  type CodingCatalog,
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
import type { JsonSchema } from "./protocol";
import { zodShape, type SdkToolResult } from "./sdk";
import { SessionLog } from "./session-log";
import { writeSkillsPlugin } from "./coding-skills";
import { asRateLimitInfo, usagePauseReason } from "./usage";

export class CodingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodingError";
  }
}

export interface CodingDeps {
  sdk: CodingSdk;
  home?: string;
  env: Record<string, string | undefined>;
  limits: CodingLimits;
  authStatus: () => Promise<ClaudeAuthStatus>;
  now: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

interface HeldMessage {
  id: string;
  uuid: string;
  text: string;
  attachments: CodingAttachment[];
  createdAt: string;
}

interface InputItem {
  message: CodingSdkUserMessage;
  taken: boolean;
}

class InputQueue {
  private readonly items: InputItem[] = [];
  private waiter: ((item: InputItem | undefined) => void) | undefined;
  private closed = false;

  push(item: InputItem): void {
    if (this.closed) return;
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  remove(item: InputItem): boolean {
    const index = this.items.indexOf(item);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  close(): void {
    this.closed = true;
    this.items.length = 0;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.(undefined);
  }

  private next(): Promise<InputItem | undefined> {
    if (this.closed) return Promise.resolve(undefined);
    const item = this.items.shift();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  async *iterate(): AsyncGenerator<CodingSdkUserMessage> {
    while (!this.closed) {
      // eslint-disable-next-line react-doctor/async-await-in-loop
      const item = await this.next();
      if (!item) return;
      item.taken = true;
      yield item.message;
    }
  }
}

interface TurnState {
  startedAt: number;
  firstInput?: InputItem;
  activity: boolean;
  stopRequested: boolean;
  stopBeforeActivity: boolean;
  usageLimit?: { reason: string; resetsAt?: string };
  cancelStopTimer?: () => void;
}

interface PendingApproval {
  approval: CodingApproval;
  settle: (result: CodingPermissionResult, status: ApprovalStatus) => void;
}

type ApprovalStatus = "allowed" | "denied" | "answered" | "expired";

interface AppToolOutcome {
  content: string;
  isError?: boolean;
}

interface PendingCall {
  resolve: (outcome: AppToolOutcome) => void;
  cancel: () => void;
}

const APP_TOOL_TIMEOUT_MS = 10 * 60_000;

function appToolName(spec: Pick<CodingToolSpec, "server" | "name">): string {
  return `mcp__${spec.server}__${spec.name}`;
}

interface UsageTotals {
  [model: string]: Record<string, number>;
}

const MAX_SENT_UUIDS = 200;

export interface CodingPartial {
  reset?: boolean;
  text?: string;
  thinking?: string;
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
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly closedApprovals = new Map<string, ApprovalStatus>();
  private readonly calls = new Map<string, PendingCall>();
  private readonly sent = new Map<string, CodingSendResult>();
  private costBase = 0;
  private usageBase: UsageTotals = {};
  private bypassAllowed = false;
  private restartWhenIdle = false;
  private lastEntryUuid: string | undefined;
  private stderrTail = "";

  constructor(
    id: string,
    config: CodingSessionConfig,
    private readonly book: CodingBook,
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
    for (const id of this.approvals.keys()) {
      this.closeApproval(
        id,
        { behavior: "deny", message: "Stopped by the user.", interrupt: true },
        "expired",
      );
    }
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
    const pending = this.approvals.get(approvalId);
    if (!pending) {
      if (this.closedApprovals.has(approvalId)) return;
      throw new CodingError("not_found", "That request is no longer open.");
    }
    const { approval } = pending;
    const input = record(approval.input) ?? {};
    const isQuestion = approval.toolName === "AskUserQuestion";
    if ("answers" in answer) {
      if (!isQuestion) throw new CodingError("bad_answer", "A tool approval takes allow or deny.");
      this.closeApproval(
        approvalId,
        {
          behavior: "allow",
          updatedInput: { ...input, answers: questionAnswers(input, answer.answers) },
        },
        "answered",
      );
      return;
    }
    if (answer.decision === "allow") {
      if (isQuestion) throw new CodingError("bad_answer", "A question takes answers.");
      this.closeApproval(approvalId, { behavior: "allow", updatedInput: input }, "allowed");
      return;
    }
    const message =
      answer.message?.trim() ||
      (isQuestion ? "The user dismissed the question." : "The user declined this tool call.");
    this.closeApproval(approvalId, { behavior: "deny", message }, "denied");
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
    this.turn = {
      startedAt: this.deps.now(),
      activity: false,
      stopRequested: false,
      stopBeforeActivity: false,
    };
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
      this.costBase = 0;
      this.usageBase = {};
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
      const detail =
        failure instanceof Error ? failure.message : failure ? String(failure) : undefined;
      const stderr = this.stderrTail.trim().split("\n").slice(-3).join("\n");
      this.endTurnSynthetic({
        error:
          detail ||
          (stderr
            ? `Claude Code stopped before the turn finished: ${stderr}`
            : "Claude Code stopped before the turn finished."),
      });
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
    } catch {}
    if (this.running) {
      this.endTurnSynthetic(error ? { error } : { interrupted: true });
    } else {
      this.emitState();
    }
  }

  private sendInterrupt(): void {
    void this.query?.interrupt().catch(() => undefined);
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
      this.turn = {
        startedAt: this.deps.now(),
        activity: true,
        stopRequested: false,
        stopBeforeActivity: false,
      };
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
    const turnCost = total >= this.costBase ? total - this.costBase : total;
    this.costBase = total;
    const usage = record(message.modelUsage);
    const turnUsage = usage ? this.usageDelta(usage) : undefined;
    const startedAt = turn?.startedAt;
    this.publish({
      type: "message",
      message: {
        ...message,
        turn_cost_usd: roundCost(turnCost),
        ...(turnUsage ? { turn_model_usage: turnUsage } : {}),
        ...(this.lastEntryUuid ? { after_uuid: this.lastEntryUuid } : {}),
        ...(typeof message.duration_ms !== "number" && startedAt !== undefined
          ? { duration_ms: this.deps.now() - startedAt }
          : {}),
        ...(turn?.usageLimit ? { usage_limit: turn.usageLimit } : {}),
        ...(turn?.stopRequested && !turn.usageLimit ? { interrupted: true } : {}),
      },
    });
    this.lastEntryUuid = typeof message.uuid === "string" ? message.uuid : this.lastEntryUuid;
    turn?.cancelStopTimer?.();
    const more = typeof message.queued_turn_count === "number" && message.queued_turn_count > 0;
    const stopped = !!turn?.stopRequested;
    this.afterTurn(more, stopped);
  }

  private afterTurn(more: boolean, stopped: boolean): void {
    if (more && this.live) {
      this.turn = {
        startedAt: this.deps.now(),
        activity: false,
        stopRequested: false,
        stopBeforeActivity: false,
      };
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
    const usageLimit = turn?.usageLimit;
    this.publish({
      type: "message",
      message: {
        type: "result",
        subtype: outcome.error ? "error_during_execution" : "success",
        synthetic: true,
        uuid,
        session_id: this.claudeSessionId ?? "",
        is_error: !!outcome.error,
        ...(outcome.error ? { errors: [outcome.error] } : { result: "" }),
        duration_ms: turn ? this.deps.now() - turn.startedAt : 0,
        num_turns: 0,
        total_cost_usd: this.costBase,
        turn_cost_usd: 0,
        ...(this.lastEntryUuid ? { after_uuid: this.lastEntryUuid } : {}),
        ...(usageLimit ? { usage_limit: usageLimit } : {}),
        ...(outcome.interrupted ? { interrupted: true } : {}),
      },
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
      message: {
        type: "system",
        subtype: "tiny_notice",
        uuid: randomUUID(),
        session_id: this.claudeSessionId ?? "",
        level: "error",
        content: text,
      },
    });
  }

  private usageDelta(usage: Record<string, unknown>): UsageTotals {
    const delta: UsageTotals = {};
    const next: UsageTotals = {};
    for (const [model, value] of Object.entries(usage)) {
      const fields = record(value);
      if (!fields) continue;
      const base = this.usageBase[model] ?? {};
      const now: Record<string, number> = {};
      const diff: Record<string, number> = {};
      for (const [key, raw] of Object.entries(fields)) {
        if (typeof raw !== "number") continue;
        now[key] = raw;
        const before = base[key] ?? 0;
        diff[key] =
          key === "contextWindow" || key === "maxOutputTokens" || raw < before ? raw : raw - before;
      }
      next[model] = now;
      delta[model] = diff;
    }
    this.usageBase = next;
    return delta;
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
    const approval: CodingApproval = {
      approvalId,
      toolName,
      input,
      ...(options.toolUseID ? { toolUseId: options.toolUseID } : {}),
      ...(options.suggestions?.length ? { suggestions: options.suggestions } : {}),
      ...(options.decisionReason ? { reason: options.decisionReason } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(options.blockedPath ? { blockedPath: options.blockedPath } : {}),
      ...(options.agentID ? { agentId: options.agentID } : {}),
    };
    return new Promise<CodingPermissionResult>((resolve) => {
      this.approvals.set(approvalId, {
        approval,
        settle: (result) => resolve(result),
      });
      this.publish({ type: "request", approval });
      options.signal.addEventListener(
        "abort",
        () =>
          this.closeApproval(
            approvalId,
            { behavior: "deny", message: "The request was cancelled.", interrupt: true },
            "expired",
          ),
        { once: true },
      );
    });
  }

  settleCall(callId: string, outcome: AppToolOutcome): boolean {
    const pending = this.calls.get(callId);
    if (!pending) return false;
    this.calls.delete(callId);
    pending.cancel();
    pending.resolve(outcome);
    this.publish({ type: "tool_call_closed", callId });
    return true;
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
    const specs = this.config.tools ?? [];
    const { tool, createSdkMcpServer } = this.deps.sdk;
    if (specs.length === 0 || !tool || !createSdkMcpServer) return {};
    const byServer = new Map<string, CodingToolSpec[]>();
    for (const spec of specs)
      byServer.set(spec.server, [...(byServer.get(spec.server) ?? []), spec]);
    const mcpServers: Record<string, unknown> = {};
    for (const [server, list] of byServer) {
      mcpServers[server] = createSdkMcpServer({
        name: server,
        version: "1.0.0",
        tools: list.map((spec) =>
          tool(spec.name, spec.description, zodShape(spec.inputSchema as JsonSchema), (args) =>
            this.callAppTool(generation, spec, args),
          ),
        ),
      });
    }
    return { mcpServers, allowedTools: specs.map(appToolName) };
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
    const callId = `tc_${randomBytes(8).toString("hex")}`;
    const schedule = this.deps.schedule ?? defaultSchedule;
    const outcome = await new Promise<AppToolOutcome>((resolve) => {
      const cancel = schedule(
        () =>
          this.settleCall(callId, {
            content: "The app did not answer this tool call in time.",
            isError: true,
          }),
        APP_TOOL_TIMEOUT_MS,
      );
      this.calls.set(callId, { resolve, cancel });
      this.publish({ type: "tool_call", callId, server: spec.server, tool: spec.name, input });
    });
    return {
      content: [{ type: "text", text: outcome.content }],
      ...(outcome.isError ? { isError: true } : {}),
    };
  }

  private closeApproval(id: string, result: CodingPermissionResult, status: ApprovalStatus): void {
    const pending = this.approvals.get(id);
    if (!pending) return;
    this.approvals.delete(id);
    this.closedApprovals.set(id, status);
    if (this.closedApprovals.size > 500) {
      const oldest = this.closedApprovals.keys().next().value;
      if (oldest) this.closedApprovals.delete(oldest);
    }
    pending.settle(result, status);
    this.publish({ type: "request_closed", approvalId: id, status });
  }

  private expireApprovals(): void {
    for (const id of this.approvals.keys()) {
      this.closeApproval(id, { behavior: "deny", message: "The session stopped." }, "expired");
    }
    for (const id of this.calls.keys()) {
      this.settleCall(id, { content: "The session stopped.", isError: true });
    }
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

export class CodingBook {
  private readonly sessions = new Map<string, CodingSession>();
  catalog: CodingCatalog | undefined;
  onCatalog: ((catalog: CodingCatalog) => void) | undefined;
  onPartial: ((sessionId: string, partial: CodingPartial) => void) | undefined;
  private catalogLoading = false;

  constructor(readonly deps: CodingDeps) {}

  get(id: string): CodingSession | undefined {
    return this.sessions.get(id);
  }

  list(): CodingSession[] {
    return [...this.sessions.values()];
  }

  ensure(id: string, config: CodingSessionConfig): CodingSession {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.configure(config);
      return existing;
    }
    const session = new CodingSession(id, config, this, this.deps);
    this.sessions.set(id, session);
    return session;
  }

  liveProcesses(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.live || session.starting) count += 1;
    }
    return count;
  }

  runningTurns(): number {
    let count = 0;
    for (const session of this.sessions.values()) if (session.running) count += 1;
    return count;
  }

  checkTurnSlot(session: CodingSession): void {
    const others = this.runningTurns() - (session.running ? 1 : 0);
    if (others >= this.deps.limits.maxRunningTurns) {
      throw new CodingError(
        "turn_busy",
        `${this.deps.limits.maxRunningTurns} Claude Code turns are already running. ` +
          "Wait for one to finish, or queue this message.",
      );
    }
  }

  reserveProcess(session: CodingSession): void {
    if (session.live || session.starting) return;
    if (this.liveProcesses() < this.deps.limits.maxLiveProcesses) return;
    const idle = [...this.sessions.values()]
      .filter((other) => other !== session && other.live && !other.busy)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const victim = idle[0];
    if (!victim) {
      throw new CodingError(
        "at_capacity",
        `${this.deps.limits.maxLiveProcesses} Claude Code sessions are busy. ` +
          "Stop one, or wait for one to finish.",
      );
    }
    victim.close();
  }

  sweep(now: number): void {
    for (const session of this.sessions.values()) {
      if (!session.live || session.busy) continue;
      if (now - session.lastUsed >= this.deps.limits.idleEvictMs) session.close();
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close();
  }

  async fetchCatalog(query: CodingQuery): Promise<void> {
    if (this.catalogLoading) return;
    this.catalogLoading = true;
    try {
      const [commands, models] = await Promise.all([
        query.supportedCommands().catch(() => []),
        query.supportedModels ? query.supportedModels().catch(() => []) : Promise.resolve([]),
      ]);
      if (commands.length === 0 && models.length === 0) return;
      this.catalog = {
        commands: commands.map((command) => ({
          name: command.name,
          description: command.description,
          argumentHint: command.argumentHint,
        })),
        models: models.map((model) => ({
          value: model.value,
          displayName: model.displayName,
          description: model.description,
          ...(model.supportedEffortLevels
            ? { supportedEffortLevels: model.supportedEffortLevels }
            : {}),
        })),
      };
      this.onCatalog?.(this.catalog);
    } finally {
      this.catalogLoading = false;
    }
  }
}

export function questionAnswers(
  input: Record<string, unknown>,
  answers: Record<string, string>,
): Record<string, string> {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  const out: Record<string, string> = {};
  questions.forEach((raw, index) => {
    const question = record(raw);
    const text = typeof question?.question === "string" ? question.question : undefined;
    if (!text) return;
    const header = typeof question?.header === "string" ? question.header : undefined;
    const value = answers[text] ?? (header ? answers[header] : undefined) ?? answers[String(index)];
    if (value !== undefined) out[text] = value;
  });
  return out;
}

function isCodingMode(mode: string): mode is NonNullable<CodingSessionConfig["permissionMode"]> {
  return (
    mode === "default" || mode === "acceptEdits" || mode === "plan" || mode === "bypassPermissions"
  );
}

function resetsAtOf(value: unknown): { resetsAt?: string } {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return {};
  const ms = value < 1e12 ? value * 1000 : value;
  return { resetsAt: new Date(ms).toISOString() };
}

function roundCost(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}
