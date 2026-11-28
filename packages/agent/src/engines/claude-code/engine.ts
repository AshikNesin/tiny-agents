import { readFile, rename } from "node:fs/promises";
import type { Context } from "@earendil-works/chord/context";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  defineDoc,
  type ConversationId,
  type EntryRecord,
  type Harness,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { ToolResultPayload, ToolSpec, WorkerMessage } from "@tiny-agents/claude-worker";
import { z } from "zod";
import { gateHooksOf } from "../../approvals";
import type { ToolPermission } from "../../capabilities";
import {
  type AgentEngine,
  type ClaudeEngineFallback,
  type ClaudePlanState,
  type CompiledConversation,
  type EngineSubmission,
} from "../../engine";
import { ranToResult, ToolGate } from "../../gate";
import { secretRedactor } from "../../redact";
import { finishedToolRow, liveToolRow, type ToolCallRow } from "../../tool-call-row";
import { gateUserMessages, windowChat } from "../../transcript";
import type {
  ChatEvent,
  ChatMessage,
  ChatState,
  ChatSubscription,
  ChatToolCall,
  ConversationRef,
  QueuedMessage,
  WithdrawOutcome,
} from "../../types";
import { WaitTracker } from "../../waiting";
import { loadHistory } from "../../conversation-store";
import { ClaudeWorkerClient, type ToolUseCall, type WebSocketLike } from "./client";
import { pauseMessage } from "./errors";
import { noWorkerLocator, type ClaudeWorkerLocator } from "./sandbox-worker";
import { claudeToolApi } from "./tools";
import {
  admittedRequestId,
  claudeMessages,
  claudeRecordOf,
  legacyEntries,
  legacyFileSchema,
  replyEntry,
  settleToolCalls,
  userEntry,
  withdrawnEntry,
  type ClaudeRecord,
  type ClaudeReply,
  type LegacySession,
} from "./transcript";

const ctx: Context = BACKGROUND_CONTEXT;

export const WORKER_RESTARTED =
  "The Claude worker restarted and this reply was cut off. Send your message again to continue.";

const NOT_CONFIGURED = "This bot's settings are not loaded yet. Send your message again.";

const TASK_ID_BASE = 2_000_000_000;

const ADMIT_LOOKBACK = 200;

export const OWNER_WAIT_KEEPALIVE_MS = 30_000;

const ClaudePlanDoc = defineDoc<{
  conversations: Record<string, { left?: boolean; claudeSessionId?: string }>;
  imported?: boolean;
}>({
  kind: "tiny.claude-plan",
  version: 1,
  scope: "session",
  initial: () => ({ conversations: {} }),
  checkpointWhen: () => false,
});

export interface ClaudeSessionSync {
  model: string;
  system: string;
  tools: ToolSpec[];
  permissions: Record<string, ToolPermission>;
  runners?: ReadonlyMap<string, ToolRegistration>;
}

export interface ClaudeCodeEngineOptions {
  harness?: Harness;
  plan?: () => ClaudePlanState;
  legacyPath?: string;
  onBusy?: (ref: ConversationRef, busy: boolean) => void;
  fallback?: (ref: ConversationRef, input: EngineSubmission) => Promise<void>;
  onReport?: (error: unknown) => void;
  gate?: ToolGate;
  connect?: (url: string, token: string) => WebSocketLike;
  worker?: ClaudeWorkerLocator;
}

interface Listener {
  ref: ConversationRef;
  listener: (events: ChatEvent[]) => void | Promise<void>;
  window?: number;
}

interface LiveTurn {
  turnId: string;
  reply: ClaudeReply;
  sent: boolean;
  dispatched: boolean;
  closed: boolean;
  waits: Map<string, ReturnType<typeof setInterval>>;
}

interface Stored {
  left: boolean;
  claudeSessionId?: string;
}

interface ClaudeSession {
  model: string;
  system: string;
  tools: ToolSpec[];
  permissions: Record<string, ToolPermission>;
  runners: ReadonlyMap<string, ToolRegistration>;
  configured: boolean;
  claudeSessionId?: string;
  surface: "claude" | "pi";
  stored?: Stored;
  records?: Promise<ClaudeRecord[]>;
  queue: EngineSubmission[];
  withdrawing: Set<string>;
  live?: LiveTurn;
  nextTask: number;
  busy: boolean;
  writes: Promise<unknown>;
}

export class ClaudeCodeEngine implements AgentEngine {
  readonly kind = "claude-code" as const;
  private readonly sessions = new Map<ConversationRef, ClaudeSession>();
  private readonly listeners = new Set<Listener>();
  private client: ClaudeWorkerClient | undefined;
  private readonly plan: () => ClaudePlanState;
  private readonly gate: ToolGate;
  private docWrites: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ClaudeCodeEngineOptions) {
    this.plan = options.plan ?? (() => ({ enabled: false, fallback: "pause" }));
    this.gate = options.gate ?? new ToolGate({ approvals: new WaitTracker() });
  }

  async start(): Promise<void> {
    if (!this.options.harness) return;
    await this.importLegacy();
    const doc = await this.harness.snapshot(ClaudePlanDoc, ctx);
    for (const [key, value] of Object.entries(doc?.conversations ?? {})) {
      const ref = Number(key);
      if (!Number.isFinite(ref) || this.sessions.has(ref)) continue;
      const stored: Stored = {
        left: value.left === true,
        ...(value.claudeSessionId ? { claudeSessionId: value.claudeSessionId } : {}),
      };
      const session = this.blank();
      session.surface = stored.left ? "pi" : "claude";
      session.stored = stored;
      if (stored.claudeSessionId) session.claudeSessionId = stored.claudeSessionId;
      this.sessions.set(ref, session);
    }
  }

  runs(ref: ConversationRef): boolean {
    return this.sessions.get(ref)?.surface === "claude";
  }

  async configure(
    ref: ConversationRef,
    compiled: Pick<CompiledConversation, "claude">,
  ): Promise<void> {
    const info = compiled.claude;
    if (!info) {
      await this.leave(ref);
      return;
    }
    const session = this.ensure(ref);
    session.model = info.model;
    session.system = info.system;
    session.tools = info.tools;
    session.permissions = info.permissions;
    session.runners = info.runners ?? new Map();
    session.configured = true;
    await this.remember(ref, session);
  }

  private async leave(ref: ConversationRef): Promise<void> {
    const session = this.sessions.get(ref);
    if (!session || session.surface === "pi") return;
    session.surface = "pi";
    await this.remember(ref, session);
  }

  busy(ref: ConversationRef): boolean {
    return this.sessions.get(ref)?.busy === true;
  }

  async submit(ref: ConversationRef, input: EngineSubmission): Promise<"accepted" | "unavailable"> {
    const session = this.sessions.get(ref);
    if (!session || session.surface !== "claude") return "unavailable";
    const { enabled, fallback } = this.plan();
    if (!enabled && fallback === "gateway") {
      await this.leave(ref);
      return "unavailable";
    }
    const paused = enabled
      ? undefined
      : pauseMessage("The Claude plan is turned off (Settings → Models).");
    return this.write(ref, session, async (records): Promise<"accepted"> => {
      if (records.some((r) => r.kind === "user" && r.data.requestId === input.requestId)) {
        return "accepted";
      }
      const user = {
        requestId: input.requestId,
        text: input.text,
        createdAt: Date.now(),
        ...(input.peer ? { peer: input.peer } : {}),
        ...(input.author ? { author: { id: input.author.id, name: input.author.name } } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      };
      const pause: ClaudeReply | undefined = paused
        ? {
            turnId: input.requestId,
            text: "",
            status: "error",
            error: paused,
            createdAt: Date.now(),
          }
        : undefined;
      const appended = await this.harness.commit(async (tx) => {
        const recent = await tx.scanEntries(
          { conversationId: ref as ConversationId, order: "descending" },
          ADMIT_LOOKBACK,
        );
        if (recent.items.some((entry) => admittedRequestId(entry) === input.requestId)) return [];
        const added = [await tx.appendEntry(ref as ConversationId, userEntry(user))];
        if (pause) added.push(await tx.appendEntry(ref as ConversationId, replyEntry(pause)));
        return added;
      }, ctx);
      for (const entry of appended) {
        const record = this.recordOf(entry);
        if (record) records.push(record);
      }
      if (appended.length === 0 || pause) {
        this.emit(ref);
        return "accepted";
      }
      session.queue.push(input);
      this.setBusy(ref, session, true);
      this.emit(ref);
      this.pump(ref, session);
      return "accepted";
    });
  }

  async abort(ref: ConversationRef): Promise<void> {
    const session = this.sessions.get(ref);
    if (!session) return;
    const queued = session.queue.filter((input) => !input.peer);
    session.queue = session.queue.filter((input) => input.peer);
    if (queued.length > 0) {
      await this.withdrawn(
        ref,
        session,
        queued.map((input) => input.requestId),
      );
    }
    const live = session.live;
    if (live && !live.closed) {
      this.client?.send({ type: "abort", sessionId: String(ref) });
      await this.finish(ref, session, live.turnId, "stopped");
      return;
    }
    if (!session.live && session.busy) {
      this.setBusy(ref, session, false);
      this.emit(ref);
    }
  }

  async withdraw(ref: ConversationRef, requestId: string): Promise<WithdrawOutcome> {
    const session = this.sessions.get(ref);
    if (!session) return "not_found";
    const index = session.queue.findIndex((input) => input.requestId === requestId);
    if (index >= 0) {
      session.queue.splice(index, 1);
      await this.withdrawn(ref, session, [requestId]);
      return "withdrawn";
    }
    if (session.live?.turnId === requestId && !session.live.closed) return "already_placed";
    const records = await this.records(ref, session);
    if (records.some((r) => r.kind === "withdrawn" && r.requestIds.includes(requestId))) {
      return "withdrawn";
    }
    return records.some((r) => r.kind === "user" && r.data.requestId === requestId)
      ? "settled"
      : "not_found";
  }

  async userMessages(ref: ConversationRef) {
    const session = this.sessions.get(ref);
    if (!session) return [];
    return gateUserMessages(await this.messages(ref, session));
  }

  async read(ref: ConversationRef): Promise<ChatState> {
    const session = this.require(ref);
    return this.state(session, await this.messages(ref, session));
  }

  async watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    { window }: { window?: number } = {},
  ): Promise<ChatSubscription> {
    const session = this.require(ref);
    const initial = this.state(session, await this.messages(ref, session), window);
    const entry: Listener = { ref, listener, window };
    this.listeners.add(entry);
    void listener([{ type: "snapshot", state: initial }]);
    return {
      initial,
      stop: async () => {
        this.listeners.delete(entry);
      },
    };
  }

  private locator(): ClaudeWorkerLocator {
    return this.options.worker ?? noWorkerLocator;
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.live) this.stopWaits(session.live);
    }
    this.client?.close();
    this.options.worker?.close();
    await Promise.allSettled([
      this.docWrites,
      ...[...this.sessions.values()].map((session) => session.writes),
    ]);
  }

  private pump(ref: ConversationRef, session: ClaudeSession): void {
    if (session.live) return;
    const next = session.queue.shift();
    if (!next) {
      if (session.busy) {
        this.setBusy(ref, session, false);
        this.emit(ref);
      }
      return;
    }
    void this.runTurn(ref, session, next).catch((error: unknown) => this.report(error));
  }

  private async runTurn(
    ref: ConversationRef,
    session: ClaudeSession,
    input: EngineSubmission,
  ): Promise<void> {
    const turnId = input.requestId;
    const live: LiveTurn = {
      turnId,
      reply: {
        turnId,
        text: "",
        status: "streaming",
        ...(session.model ? { model: session.model } : {}),
        createdAt: Date.now(),
      },
      sent: false,
      dispatched: false,
      closed: false,
      waits: new Map(),
    };
    session.live = live;
    this.emit(ref);
    if (session.surface !== "claude") {
      await this.handOff(ref, session, live, input);
      return;
    }
    const { enabled, fallback, maxTurns } = this.plan();
    if (!enabled) {
      await this.unavailable(
        ref,
        session,
        live,
        input,
        fallback,
        "The Claude plan is turned off (Settings → Models).",
      );
      return;
    }
    if (!session.configured) {
      await this.finish(ref, session, turnId, "error", NOT_CONFIGURED);
      return;
    }
    try {
      await this.locator().resolve();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await this.unavailable(ref, session, live, input, fallback, detail);
      return;
    }
    if (live.closed) return;
    const worker = this.worker();
    worker.track(String(ref));
    live.sent = true;
    live.dispatched = worker.send({
      type: "turn",
      sessionId: String(ref),
      turnId,
      text: input.text,
      model: session.model,
      system: session.system,
      ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
      tools: session.tools,
      ...(input.images?.length ? { images: input.images } : {}),
      ...(maxTurns ? { maxTurns } : {}),
    });
  }

  private async unavailable(
    ref: ConversationRef,
    session: ClaudeSession,
    live: LiveTurn,
    input: EngineSubmission,
    fallback: ClaudeEngineFallback,
    detail: string,
  ): Promise<void> {
    if (fallback === "gateway") {
      await this.leave(ref);
      await this.handOff(ref, session, live, input);
      return;
    }
    await this.finish(ref, session, live.turnId, "error", pauseMessage(detail));
  }

  private async handOff(
    ref: ConversationRef,
    session: ClaudeSession,
    live: LiveTurn,
    input: EngineSubmission,
  ): Promise<void> {
    live.closed = true;
    session.live = undefined;
    const rest = [input, ...session.queue.splice(0)];
    for (const message of rest) {
      try {
        // eslint-disable-next-line react-doctor/async-await-in-loop
        await this.options.fallback?.(ref, message);
      } catch (error) {
        this.report(error);
      }
    }
    this.setBusy(ref, session, false);
    this.emit(ref);
  }

  private async finish(
    ref: ConversationRef,
    session: ClaudeSession,
    turnId: string,
    status: "done" | "error" | "stopped",
    error?: string,
  ): Promise<void> {
    const live = session.live;
    if (!live || live.turnId !== turnId || live.closed) return;
    live.closed = true;
    this.stopWaits(live);
    const toolCalls = settleToolCalls(
      live.reply.toolCalls,
      status === "stopped" ? "aborted" : "interrupted",
    );
    const reply: ClaudeReply = {
      ...live.reply,
      status,
      ...(error ? { error } : {}),
      ...(toolCalls ? { toolCalls } : {}),
    };
    live.reply = reply;
    await this.appendReply(ref, session, reply);
    session.live = undefined;
    const more = session.queue.length > 0;
    if (!more) session.busy = false;
    this.gate.abandon(ref);
    if (!more) this.options.onBusy?.(ref, false);
    this.emit(ref);
    this.pump(ref, session);
  }

  private async appendReply(
    ref: ConversationRef,
    session: ClaudeSession,
    reply: ClaudeReply,
  ): Promise<void> {
    const snapshot = structuredClone(reply);
    await this.write(ref, session, async (records) => {
      try {
        const entry = await this.harness.commit(
          (tx) => tx.appendEntry(ref as ConversationId, replyEntry(snapshot)),
          ctx,
        );
        const record = this.recordOf(entry);
        if (record) records.push(record);
      } catch (error) {
        records.push({ kind: "reply", data: snapshot });
        this.report(error);
      }
    });
  }

  private async withdrawn(
    ref: ConversationRef,
    session: ClaudeSession,
    requestIds: string[],
  ): Promise<void> {
    for (const id of requestIds) session.withdrawing.add(id);
    try {
      await this.write(ref, session, async (records) => {
        const entry = await this.harness.commit(
          (tx) => tx.appendEntry(ref as ConversationId, withdrawnEntry(requestIds)),
          ctx,
        );
        const record = this.recordOf(entry);
        if (record) records.push(record);
      });
    } catch (error) {
      this.report(error);
      return;
    }
    for (const id of requestIds) session.withdrawing.delete(id);
    this.emit(ref);
  }

  private worker(): ClaudeWorkerClient {
    this.client ??= new ClaudeWorkerClient({
      resolveTarget: () => this.locator().resolve(),
      ...(this.options.connect ? { connect: this.options.connect } : {}),
      onEvent: (message) => this.onWorker(message),
      onTool: (call) => this.onTool(call),
      onConnected: (rebooted) => this.onConnected(rebooted),
      onUnauthorized: () => this.locator().invalidate(),
    });
    return this.client;
  }

  private onConnected(rebooted: boolean): void {
    for (const [ref, session] of this.sessions) {
      const live = session.live;
      if (!live?.sent || live.closed) continue;
      if (rebooted && live.dispatched) {
        void this.finish(ref, session, live.turnId, "error", WORKER_RESTARTED);
        continue;
      }
      live.dispatched = true;
    }
  }

  private async onTool(call: ToolUseCall): Promise<ToolResultPayload> {
    const ref = Number(call.sessionId);
    const session = this.sessions.get(ref);
    if (!session) return { content: "Unknown conversation.", isError: true };
    const live = session.live;
    if (!live || live.turnId !== call.turnId || live.closed) {
      return { content: "This reply has ended.", isError: true };
    }
    const args = asRecord(call.input);
    const row = (fields: ToolCallRow) => {
      if (live.closed) return;
      const tool: ChatToolCall = { id: call.toolUseId, name: call.name, args, ...fields };
      upsertTool(live.reply, tool);
      this.ownerWait(ref, live, call.toolUseId, tool.status);
      this.emit(ref);
    };
    const finished = (fields: ToolCallRow) => {
      row(fields);
      if (!live.closed) void this.appendReply(ref, session, live.reply);
    };
    const failed = (content: string): ToolResultPayload => {
      finished(finishedToolRow({ output: content, isError: true }));
      return { content, isError: true };
    };
    row(liveToolRow({ status: "running" }));
    if (session.permissions[call.name] === "off")
      return failed(`${call.name} is off for this bot.`);
    session.nextTask += 1;
    const taskId = session.nextTask;
    let published: unknown;
    const api = claudeToolApi({
      name: call.name,
      conversation: ref,
      task: taskId,
      docs: this.harness,
      details: (value) => {
        published = value;
        row(liveToolRow({ status: "running", taskId, details: value }));
      },
    });
    const runner = session.runners.get(call.name);
    try {
      const result = await this.gate
        .run(
          {
            name: call.name,
            args,
            replaySafe: runner?.replay === "safe",
            hooks: runner ? gateHooksOf(runner) : undefined,
            api,
            context: ctx,
            answers: "memory",
            userMessages: () => this.userMessages(ref),
            instructions: async () => session.system || undefined,
            run: async () => `${ref}:${live.turnId}`,
          },
          async (inner) => {
            row(liveToolRow({ status: "running", taskId }));
            if (!runner) return unavailable(call.name);
            return ranToResult(await runner.execute(args, inner, ctx));
          },
        )
        .then(ranToResult);
      const content = resultText(result);
      finished(
        finishedToolRow({
          output: content,
          details: result.details ?? published,
          ...(result.isError ? { isError: true } : {}),
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        }),
      );
      return { content, ...(result.isError ? { isError: true } : {}) };
    } catch (error) {
      return failed(secretRedactor.scrub(error instanceof Error ? error.message : String(error)));
    }
  }

  private ownerWait(
    ref: ConversationRef,
    live: LiveTurn,
    toolUseId: string,
    status: ChatToolCall["status"],
  ): void {
    const waiting = status.startsWith("awaiting_");
    const timer = live.waits.get(toolUseId);
    if (!waiting) {
      if (timer) clearInterval(timer);
      live.waits.delete(toolUseId);
      return;
    }
    if (timer) return;
    const tell = () =>
      this.client?.send({ type: "tool_waiting", sessionId: String(ref), toolUseId });
    tell();
    const next = setInterval(tell, OWNER_WAIT_KEEPALIVE_MS);
    next.unref?.();
    live.waits.set(toolUseId, next);
  }

  private stopWaits(live: LiveTurn): void {
    for (const timer of live.waits.values()) clearInterval(timer);
    live.waits.clear();
  }

  private onWorker(message: WorkerMessage): void {
    if (message.type === "error") {
      const ref = Number(message.sessionId);
      const session = this.sessions.get(ref);
      const live = session?.live;
      if (session && live && (!message.turnId || message.turnId === live.turnId)) {
        void this.finish(ref, session, live.turnId, "error", message.message);
      }
      return;
    }
    if (message.type !== "event") return;
    const ref = Number(message.sessionId);
    const session = this.sessions.get(ref);
    if (!session) return;
    const event = message.event;
    if (event.type === "session") {
      if (session.claudeSessionId === event.claudeSessionId) return;
      session.claudeSessionId = event.claudeSessionId;
      void this.remember(ref, session);
      return;
    }
    const live = session.live;
    if (!live || live.closed || !("turnId" in event) || event.turnId !== live.turnId) return;
    if (event.type === "text") {
      live.reply.text = event.text;
      this.emit(ref);
      return;
    }
    if (event.type === "usage_pause") {
      void this.finish(
        ref,
        session,
        live.turnId,
        "error",
        pauseMessage(`Usage-credit guard: ${event.reason}.`),
      );
      return;
    }
    if (event.type === "turn_end") {
      void this.finish(
        ref,
        session,
        live.turnId,
        event.stopReason === "end_turn" ? "done" : "error",
        event.error,
      );
    }
  }

  private async messages(ref: ConversationRef, session: ClaudeSession): Promise<ChatMessage[]> {
    const records = await this.records(ref, session);
    return claudeMessages(records, {
      ...(session.live ? { reply: session.live.reply } : {}),
      queued: new Set([...session.queue.map((input) => input.requestId), ...session.withdrawing]),
    });
  }

  private state(session: ClaudeSession, messages: ChatMessage[], window?: number): ChatState {
    const state = { messages, busy: session.busy, queued: this.queued(session) };
    return window && messages.length > window ? windowChat(state, window)! : state;
  }

  private queued(session: ClaudeSession): QueuedMessage[] {
    return session.queue
      .filter((input) => !input.peer)
      .map((input) => ({
        requestId: input.requestId,
        mode: "followUp" as const,
        text: input.text,
        ...(input.author ? { author: input.author } : {}),
      }));
  }

  private emit(ref: ConversationRef): void {
    const session = this.sessions.get(ref);
    if (!session || ![...this.listeners].some((entry) => entry.ref === ref)) return;
    void this.messages(ref, session)
      .then((messages) => {
        for (const entry of this.listeners) {
          if (entry.ref !== ref) continue;
          void entry.listener([
            { type: "snapshot", state: this.state(session, messages, entry.window) },
          ]);
        }
      })
      .catch((error: unknown) => this.report(error));
  }

  private records(ref: ConversationRef, session: ClaudeSession): Promise<ClaudeRecord[]> {
    session.records ??= this.load(ref);
    return session.records;
  }

  private async load(ref: ConversationRef): Promise<ClaudeRecord[]> {
    const conversation = await this.harness.conversation(ref as ConversationId, ctx);
    if (!conversation) return [];
    return (await loadHistory(conversation)).flatMap((entry) => this.recordOf(entry) ?? []);
  }

  private recordOf(entry: Pick<EntryRecord, "kind" | "data">): ClaudeRecord | undefined {
    try {
      return claudeRecordOf(entry);
    } catch (error) {
      this.report(error);
      return undefined;
    }
  }

  private write<T>(
    ref: ConversationRef,
    session: ClaudeSession,
    change: (records: ClaudeRecord[]) => Promise<T>,
  ): Promise<T> {
    const run = session.writes.then(async () => change(await this.records(ref, session)));
    session.writes = run.catch(writerSeesFailure);
    return run;
  }

  private async remember(ref: ConversationRef, session: ClaudeSession): Promise<void> {
    const next: Stored = {
      left: session.surface === "pi",
      ...(session.claudeSessionId ? { claudeSessionId: session.claudeSessionId } : {}),
    };
    const stored = session.stored;
    if (stored && stored.left === next.left && stored.claudeSessionId === next.claudeSessionId) {
      return;
    }
    session.stored = next;
    const run = this.docWrites.then(() =>
      this.harness.commit(async (tx) => {
        const doc = await tx.doc(ClaudePlanDoc);
        doc.conversations[String(ref)] = {
          ...(next.left ? { left: true } : {}),
          ...(next.claudeSessionId ? { claudeSessionId: next.claudeSessionId } : {}),
        };
      }, ctx),
    );
    this.docWrites = run.catch(writerSeesFailure);
    try {
      await run;
    } catch (error) {
      session.stored = stored;
      this.report(error);
    }
  }

  private async importLegacy(): Promise<void> {
    const path = this.options.legacyPath;
    if (!path) return;
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if (!isMissing(error)) this.report(new Error(`Could not read ${path}`, { cause: error }));
      return;
    }
    const doc = await this.harness.snapshot(ClaudePlanDoc, ctx);
    if (!doc?.imported) {
      let parsed: z.infer<typeof legacyFileSchema>;
      try {
        parsed = legacyFileSchema.parse(JSON.parse(raw));
      } catch (error) {
        this.report(
          new Error(`${path} is not a Claude plan transcript file; it was left as it is`, {
            cause: error,
          }),
        );
        return;
      }
      try {
        await this.harness.commit(async (tx) => {
          const state = await tx.doc(ClaudePlanDoc);
          const sessions: [string, LegacySession][] = [];
          for (const [key, session] of Object.entries(parsed.sessions ?? {})) {
            const ref = Number(key);
            if (!Number.isFinite(ref)) continue;
            // eslint-disable-next-line react-doctor/async-await-in-loop
            if (await tx.conversation(ref as ConversationId)) sessions.push([key, session]);
          }
          for (const [key, session] of sessions) {
            const ref = Number(key);
            for (const entry of legacyEntries(session)) {
              // eslint-disable-next-line react-doctor/async-await-in-loop
              await tx.appendEntry(ref as ConversationId, entry);
            }
            const left = session.surface === "pi" || state.conversations[key]?.left === true;
            const claudeSessionId =
              session.claudeSessionId ?? state.conversations[key]?.claudeSessionId;
            state.conversations[key] = {
              ...(left ? { left: true } : {}),
              ...(claudeSessionId ? { claudeSessionId } : {}),
            };
          }
          state.imported = true;
        }, ctx);
      } catch (error) {
        this.report(new Error(`Could not import ${path}; it was left as it is`, { cause: error }));
        return;
      }
    }
    try {
      await rename(path, `${path}.imported`);
    } catch (error) {
      this.report(new Error(`Imported ${path} but could not rename it`, { cause: error }));
    }
  }

  private get harness(): Harness {
    const { harness } = this.options;
    if (!harness) throw new Error("The Claude plan engine has no store.");
    return harness;
  }

  private setBusy(ref: ConversationRef, session: ClaudeSession, busy: boolean): void {
    if (session.busy === busy) return;
    session.busy = busy;
    this.options.onBusy?.(ref, busy);
  }

  private blank(): ClaudeSession {
    return {
      model: "",
      system: "",
      tools: [],
      permissions: {},
      runners: new Map(),
      configured: false,
      surface: "claude",
      queue: [],
      withdrawing: new Set(),
      nextTask: TASK_ID_BASE,
      busy: false,
      writes: Promise.resolve(),
    };
  }

  private ensure(ref: ConversationRef): ClaudeSession {
    const existing = this.sessions.get(ref);
    if (existing) return existing;
    const session = this.blank();
    this.sessions.set(ref, session);
    return session;
  }

  private require(ref: ConversationRef): ClaudeSession {
    const session = this.sessions.get(ref);
    if (!session) throw new Error(`Conversation ${ref} is not a Claude plan session`);
    return session;
  }

  private report(error: unknown): void {
    if (this.options.onReport) this.options.onReport(error);
    else console.warn("Claude plan engine:", error);
  }
}

function writerSeesFailure(): void {}

function upsertTool(reply: ClaudeReply, tool: ChatToolCall): void {
  const tools = reply.toolCalls ? [...reply.toolCalls] : [];
  const index = tools.findIndex((item) => item.id === tool.id);
  if (index >= 0) tools[index] = tool;
  else tools.push(tool);
  reply.toolCalls = tools;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function unavailable(name: string): ToolExecutionResult {
  return {
    output: [{ type: "text", text: `${name} is not available on the Claude plan engine.` }],
    isError: true,
  };
}

function resultText(result: ToolExecutionResult): string {
  return (result.output ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return { value };
}
