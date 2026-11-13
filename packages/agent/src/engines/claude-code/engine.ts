/**
 * Claude plan engine (ADR 0008, ADR 0014). Turns go to the worker over the
 * Worker connection (`client.ts` puts the bot protocol on it). The kill switch is read here, on each turn, from the
 * environment: turning it off does not redeploy or stop the worker.
 * Transcripts for these conversations live here, beside the pi-durable
 * harness; tool calls go through the runtime's Tool gate.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  DocumentReader,
  ToolExecutionResult,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import type { ToolResultPayload, ToolSpec, WorkerMessage } from "@tiny-agents/claude-worker";
import { gateHooksOf } from "../../approvals";
import type { ToolPermission } from "../../capabilities";
import {
  type AgentEngine,
  type ClaudeEngineFallback,
  type ClaudePlanState,
  type CompiledConversation,
  type EngineSubmission,
} from "../../engine";
import { ToolGate } from "../../gate";
import type { GateUserMessage } from "../../policy";
import { finishedToolRow, liveToolRow, type ToolCallRow } from "../../tool-call-row";
import { pageBefore } from "../../transcript";
import type {
  ChatEvent,
  ChatMessage,
  ChatPage,
  ChatState,
  ChatSubscription,
  ChatToolCall,
  ConversationRef,
  LastMessage,
} from "../../types";
import { WaitTracker } from "../../waiting";
import { ClaudeWorkerClient, type ToolUseCall, type WebSocketLike } from "./client";
import { pauseMessage } from "./errors";
import {
  noWorkerLocator,
  type ClaudeAccountStatus,
  type ClaudeWorkerLocator,
  type ClaudeWorkerMode,
} from "./sandbox-worker";
import { claudeToolApi } from "./tools";

const ctx: Context = BACKGROUND_CONTEXT;

/** How a turn the worker was running when it restarted ends. */
export const WORKER_RESTARTED =
  "The Claude worker restarted and this reply was cut off. Send your message again to continue.";

/** Claude plan calls are numbered from here per conversation, apart from pi's task ids. */
const TASK_ID_BASE = 2_000_000_000;

export interface ClaudeSessionSync {
  model: string;
  system: string;
  tools: ToolSpec[];
  /** Every enabled tool's permission; the gate reads the stored ones, this says which are off. */
  permissions: Record<string, ToolPermission>;
  /** What runs once the Tool gate lets a call through, by tool name. */
  runners?: ReadonlyMap<string, ToolRegistration>;
}

export interface ClaudeCodeEngineOptions {
  /** The Claude plan account's switch and fallback, read on each turn. Default: off, pause. */
  plan?: () => ClaudePlanState;
  /** JSON file for session ids and transcripts. Omitted for `:memory:` stores. */
  persistPath?: string;
  onBusy?: (ref: ConversationRef, busy: boolean) => void;
  /** Every tool call Claude asks for goes through it. Default: a gate of its own (tests). */
  gate?: ToolGate;
  /** The shared store's conversation documents (permissions, YOLO, grants) the gate and tools read. */
  docs?: Pick<DocumentReader, "snapshot">;
  /** When set, tests skip the real socket. */
  connect?: (url: string, token: string) => WebSocketLike;
  /** The worker on the sandbox, set up over SSH on first use. */
  worker?: ClaudeWorkerLocator;
}

interface Listener {
  ref: ConversationRef;
  listener: (events: ChatEvent[]) => void | Promise<void>;
  window?: number;
}

interface LiveTurn {
  turnId: string;
  assistantId: string;
  /** The turn went out on an open socket (false: it waits in the connection's queue). */
  dispatched: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface ClaudeSession {
  model: string;
  system: string;
  tools: ToolSpec[];
  permissions: Record<string, ToolPermission>;
  runners: ReadonlyMap<string, ToolRegistration>;
  claudeSessionId?: string;
  /** `pi` once the conversation left the Claude plan (`leave()`): later turns run on pi. */
  surface: "claude" | "pi";
  messages: ChatMessage[];
  nextTask: number;
  busy: boolean;
  live?: LiveTurn;
}

export class ClaudeCodeEngine implements AgentEngine {
  readonly kind = "claude-code" as const;
  private readonly sessions = new Map<ConversationRef, ClaudeSession>();
  private readonly listeners = new Set<Listener>();
  private client: ClaudeWorkerClient | undefined;
  private readonly plan: () => ClaudePlanState;
  private loaded = false;
  private readonly gate: ToolGate;

  constructor(private readonly options: ClaudeCodeEngineOptions) {
    this.plan = options.plan ?? (() => ({ enabled: false, fallback: "pause" }));
    this.gate = options.gate ?? new ToolGate({ approvals: new WaitTracker() });
  }

  runs(ref: ConversationRef): boolean {
    return this.sessions.get(ref)?.surface === "claude";
  }

  /**
   * Take the Claude plan part of the conversation's config. Without one the
   * bot left the Claude plan model, and later turns run on pi. A
   * conversation that left (or fell back to the gateway) stays left.
   */
  async configure(
    ref: ConversationRef,
    compiled: Pick<CompiledConversation, "claude">,
  ): Promise<void> {
    const info = compiled.claude;
    if (!info) {
      this.leave(ref);
      return;
    }
    const session = this.ensure(ref);
    session.model = info.model;
    session.system = info.system;
    session.tools = info.tools;
    session.permissions = info.permissions;
    session.runners = info.runners ?? new Map();
    if (session.surface !== "pi") session.surface = "claude";
  }

  /** The conversation leaves the Claude plan for good: its turns run on pi from now on. */
  leave(ref: ConversationRef): void {
    const session = this.sessions.get(ref);
    if (!session || session.surface === "pi") return;
    session.surface = "pi";
    void this.persist();
  }

  busy(ref: ConversationRef): boolean {
    return this.sessions.get(ref)?.busy === true;
  }

  /**
   * Run one turn; resolves when it ends. `unavailable`: the kill switch is
   * off or the worker is unreachable and the fallback is the gateway, so
   * the runtime hands the turn to pi. With the `pause` fallback the turn is
   * this engine's, ending in a pause error.
   */
  async submit(ref: ConversationRef, input: EngineSubmission): Promise<"accepted" | "unavailable"> {
    await this.restore();
    const session = this.sessions.get(ref);
    if (!session || session.surface !== "claude") return "unavailable";
    const { enabled, fallback, maxTurns } = this.plan();
    if (!enabled) {
      return this.unavailable(
        ref,
        session,
        fallback,
        "The Claude plan is turned off (Settings → Models).",
      );
    }
    try {
      // Sets the worker up when needed; the connection resolves it again on every reconnect.
      await this.locator().resolve();
    } catch (error) {
      return this.unavailable(
        ref,
        session,
        fallback,
        error instanceof Error ? error.message : String(error),
      );
    }
    const turnId = input.requestId;
    const user: ChatMessage = {
      id: `u-${turnId}`,
      role: "user",
      text: input.text,
      requestId: input.requestId,
      status: "done",
      createdAt: Date.now(),
      ...(input.peer ? { peer: input.peer } : {}),
      ...(input.author ? { author: input.author } : {}),
    };
    const assistantId = `a-${turnId}`;
    const assistant: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      status: "streaming",
      model: session.model,
      createdAt: Date.now(),
    };
    session.messages.push(user, assistant);
    session.busy = true;
    this.options.onBusy?.(ref, true);
    this.emit(ref);
    const live: LiveTurn = {
      turnId,
      assistantId,
      dispatched: false,
      resolve: () => undefined,
      reject: () => undefined,
    };
    const done = new Promise<void>((resolve, reject) => {
      live.resolve = resolve;
      live.reject = reject;
    });
    session.live = live;
    const worker = this.worker();
    worker.track(String(ref));
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
    await done;
    await this.persist();
    return "accepted";
  }

  async abort(ref: ConversationRef): Promise<void> {
    const session = this.sessions.get(ref);
    if (!session?.live) return;
    this.client?.send({ type: "abort", sessionId: String(ref) });
    this.finish(session, session.live.turnId, "aborted");
  }

  async lastMessage(ref: ConversationRef): Promise<LastMessage | undefined> {
    const state = await this.read(ref);
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const message = state.messages[i];
      if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
      const text = message.error ? `⚠ ${message.error}` : message.text;
      if (!text) continue;
      return { role: message.role, text, createdAt: message.createdAt };
    }
    return undefined;
  }

  /** The conversation's user messages, newest first, as the Tool gate reads them. */
  async userMessages(ref: ConversationRef): Promise<GateUserMessage[]> {
    await this.restore();
    const session = this.sessions.get(ref);
    return session ? userMessagesOf(session.messages) : [];
  }

  async read(ref: ConversationRef): Promise<ChatState> {
    await this.restore();
    return this.state(this.require(ref));
  }

  async page(
    ref: ConversationRef,
    { before, limit }: { before: string; limit: number },
  ): Promise<ChatPage | undefined> {
    await this.restore();
    return pageBefore(this.require(ref).messages, before, limit);
  }

  async watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    { window }: { window?: number } = {},
  ): Promise<ChatSubscription> {
    await this.restore();
    const session = this.require(ref);
    const initial = this.state(session, window);
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

  status(): {
    enabled: boolean;
    fallback: ClaudeEngineFallback;
    configured: boolean;
    mode: ClaudeWorkerMode;
    workerHost?: string;
  } {
    const plan = this.plan();
    const locator = this.locator();
    return {
      enabled: plan.enabled,
      fallback: plan.fallback,
      configured: locator.mode !== "none",
      mode: locator.mode,
      ...(locator.host ? { workerHost: locator.host } : {}),
    };
  }

  /** Whether Claude Code is installed and signed in where the worker runs. No secrets. */
  account(): Promise<ClaudeAccountStatus> {
    return this.locator().account();
  }

  /** Set the worker up ahead of the first turn when the engine is on. */
  prepare(): void {
    if (this.plan().enabled) this.locator().prepare();
  }

  /** The sandbox worker, or none when no sandbox is configured. */
  private locator(): ClaudeWorkerLocator {
    return this.options.worker ?? noWorkerLocator;
  }

  async close(): Promise<void> {
    this.client?.close();
    this.options.worker?.close();
    await this.persist();
  }

  private unavailable(
    ref: ConversationRef,
    session: ClaudeSession,
    fallback: ClaudeEngineFallback,
    detail: string,
  ): "accepted" | "unavailable" {
    if (fallback === "gateway") return "unavailable";
    session.messages.push({
      id: `a-pause-${Date.now()}`,
      role: "assistant",
      text: "",
      status: "error",
      error: pauseMessage(detail),
      createdAt: Date.now(),
    });
    this.emit(ref);
    void this.persist();
    return "accepted";
  }

  /** One connection for the engine's life; it finds the worker again on every reconnect. */
  private worker(): ClaudeWorkerClient {
    this.client ??= new ClaudeWorkerClient({
      resolveTarget: () => this.locator().resolve(),
      ...(this.options.connect ? { connect: this.options.connect } : {}),
      onEvent: (message) => this.onWorker(message),
      onTool: (call) => this.onTool(call),
      onConnected: (rebooted) => this.onConnected(rebooted),
    });
    return this.client;
  }

  /**
   * After every (re)connect, before queued turns go out. A worker that
   * restarted lost the turns it was running: they end now, with an error the
   * owner can see, instead of waiting forever. The conversation keeps its
   * Claude session id, so the next turn resumes it. Turns still queued go to
   * the new worker.
   */
  private onConnected(rebooted: boolean): void {
    for (const session of this.sessions.values()) {
      const live = session.live;
      if (!live) continue;
      if (rebooted && live.dispatched) {
        this.finish(session, live.turnId, "error", WORKER_RESTARTED);
        continue;
      }
      live.dispatched = true;
    }
  }

  /**
   * Claude asks for a tool: the call goes through the Tool gate like a pi
   * call, with its answer held by the gate (a Claude call does not survive
   * a restart). Its row in the chat is the one a pi call gets: projected
   * from the details it publishes while it runs (any Owner wait's card),
   * then from its result.
   */
  private async onTool(call: ToolUseCall): Promise<ToolResultPayload> {
    const ref = Number(call.sessionId);
    const session = this.sessions.get(ref);
    if (!session) return { content: "Unknown conversation.", isError: true };
    const args = asRecord(call.input);
    const row = (fields: ToolCallRow) => {
      this.upsertTool(session, call.turnId, {
        id: call.toolUseId,
        name: call.name,
        args,
        ...fields,
      });
      this.emit(ref);
    };
    const failed = (content: string): ToolResultPayload => {
      row(finishedToolRow({ output: content, isError: true }));
      return { content, isError: true };
    };
    row(liveToolRow({ status: "running" }));
    if (session.permissions[call.name] === "off")
      return failed(`${call.name} is off for this bot.`);
    session.nextTask += 1;
    const taskId = session.nextTask;
    // As on pi, a result without details keeps the last ones the call published.
    let published: unknown;
    const api = claudeToolApi({
      name: call.name,
      conversation: ref,
      task: taskId,
      ...(this.options.docs ? { docs: this.options.docs } : {}),
      details: (value) => {
        published = value;
        row(liveToolRow({ status: "running", taskId, details: value }));
      },
    });
    const runner = session.runners.get(call.name);
    try {
      const result = await this.gate.run(
        {
          name: call.name,
          args,
          replaySafe: runner?.replay === "safe",
          hooks: runner ? gateHooksOf(runner) : undefined,
          api,
          context: ctx,
          answers: "memory",
          userMessages: async () => userMessagesOf(session.messages),
          instructions: async () => session.system || undefined,
        },
        async () => {
          row(liveToolRow({ status: "running", taskId }));
          if (!runner) return unavailable(call.name);
          return runner.execute(args, api, ctx);
        },
      );
      const content = resultText(result);
      // The Claude plan does not time its calls: the row has no duration.
      row(
        finishedToolRow({
          output: content,
          details: result.details ?? published,
          ...(result.isError ? { isError: true } : {}),
          ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
        }),
      );
      return { content, ...(result.isError ? { isError: true } : {}) };
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
  }

  private refOf(session: ClaudeSession): ConversationRef {
    for (const [ref, candidate] of this.sessions) if (candidate === session) return ref;
    return 0;
  }

  private onWorker(message: WorkerMessage): void {
    if (message.type === "error") {
      const ref = Number(message.sessionId);
      const session = this.sessions.get(ref);
      if (session?.live && (!message.turnId || message.turnId === session.live.turnId)) {
        this.finish(session, session.live.turnId, "error", message.message);
      }
      return;
    }
    if (message.type !== "event") return;
    const ref = Number(message.sessionId);
    const session = this.sessions.get(ref);
    if (!session) return;
    const event = message.event;
    if (event.type === "session") {
      session.claudeSessionId = event.claudeSessionId;
      void this.persist();
      return;
    }
    if (event.type === "text") {
      const messageRow = session.messages.find((item) => item.id === `a-${event.turnId}`);
      if (messageRow) messageRow.text = event.text;
      this.emit(ref);
      return;
    }
    if (event.type === "usage_pause") {
      this.finish(
        session,
        event.turnId,
        "error",
        pauseMessage(`Usage-credit guard: ${event.reason}.`),
      );
      return;
    }
    if (event.type === "turn_end") {
      this.finish(
        session,
        event.turnId,
        event.stopReason === "end_turn" ? "done" : "error",
        event.error,
      );
    }
  }

  private finish(
    session: ClaudeSession,
    turnId: string,
    status: "done" | "error" | "aborted",
    error?: string,
  ): void {
    const row = session.messages.find((item) => item.id === `a-${turnId}`);
    if (row) {
      row.status = status === "aborted" ? "stopped" : status === "error" ? "error" : "done";
      if (error) row.error = error;
    }
    session.busy = false;
    const live = session.live;
    session.live = undefined;
    const ref = this.refOf(session);
    // A call still waiting on the owner belongs to the turn that ended.
    this.gate.abandon(ref);
    this.options.onBusy?.(ref, false);
    this.emit(ref);
    if (live?.turnId === turnId) live.resolve();
    void this.persist();
  }

  private upsertTool(session: ClaudeSession, turnId: string, tool: ChatToolCall): void {
    const row = session.messages.find((item) => item.id === `a-${turnId}`);
    if (!row) return;
    const tools = row.toolCalls ? [...row.toolCalls] : [];
    const index = tools.findIndex((item) => item.id === tool.id);
    // Each update is the whole row: a finished call keeps nothing of its wait.
    if (index >= 0) tools[index] = tool;
    else tools.push(tool);
    row.toolCalls = tools;
  }

  private state(session: ClaudeSession, window?: number): ChatState {
    const all = session.messages.filter(
      (message) => message.text || message.toolCalls?.length || message.error,
    );
    if (!window || all.length <= window) {
      return { messages: all, busy: session.busy, queued: [] };
    }
    const messages = all.slice(-window);
    return {
      messages,
      busy: session.busy,
      queued: [],
      hasMore: true,
      cursor: messages[0]?.id,
    };
  }

  private emit(ref: ConversationRef): void {
    const session = this.sessions.get(ref);
    if (!session) return;
    for (const entry of this.listeners) {
      if (entry.ref !== ref) continue;
      void entry.listener([{ type: "snapshot", state: this.state(session, entry.window) }]);
    }
  }

  private ensure(ref: ConversationRef): ClaudeSession {
    const existing = this.sessions.get(ref);
    if (existing) return existing;
    const session = {
      model: "",
      system: "",
      tools: [] as ToolSpec[],
      permissions: {} as Record<string, ToolPermission>,
      runners: new Map<string, ToolRegistration>(),
      surface: "claude" as const,
      messages: [] as ChatMessage[],
      nextTask: TASK_ID_BASE,
      busy: false,
    };
    this.sessions.set(ref, session);
    return session;
  }

  private require(ref: ConversationRef): ClaudeSession {
    const session = this.sessions.get(ref);
    if (!session) throw new Error(`Conversation ${ref} is not a Claude plan session`);
    return session;
  }

  private async restore(): Promise<void> {
    if (this.loaded || !this.options.persistPath) {
      this.loaded = true;
      return;
    }
    this.loaded = true;
    try {
      const raw = await readFile(this.options.persistPath, "utf8");
      const parsed = JSON.parse(raw) as { sessions?: Record<string, ClaudeSession> };
      for (const [key, value] of Object.entries(parsed.sessions ?? {})) {
        const ref = Number(key);
        const existing = this.sessions.get(ref);
        if (existing) {
          // `sync()` ran before the file loaded (the first read after a
          // restart): keep its config, take the saved transcript and resume id.
          if (existing.messages.length === 0) {
            existing.messages = value.messages ?? [];
            existing.claudeSessionId ??= value.claudeSessionId;
            existing.nextTask = Math.max(existing.nextTask, value.nextTask ?? TASK_ID_BASE);
            if (value.surface === "pi") existing.surface = "pi";
          }
          continue;
        }
        // What runs a tool comes from the runtime's sync, never the file.
        const restored = {
          ...value,
          busy: false,
          live: undefined,
          runners: new Map<string, ToolRegistration>(),
        } as ClaudeSession;
        this.sessions.set(ref, restored);
      }
    } catch {
      // No file yet.
    }
  }

  private async persist(): Promise<void> {
    if (!this.options.persistPath) return;
    // Never overwrite the file before it was read, or a restart loses it.
    await this.restore();
    const sessions: Record<string, ClaudeSession> = {};
    for (const [ref, session] of this.sessions) {
      const { runners: _runners, ...rest } = session;
      sessions[String(ref)] = { ...rest, live: undefined, busy: false } as ClaudeSession;
    }
    await mkdir(dirname(this.options.persistPath), { recursive: true });
    await writeFile(this.options.persistPath, JSON.stringify({ sessions }), "utf8");
  }
}

/** The conversation's user messages, newest first, as the Tool gate reads them. */
function userMessagesOf(messages: readonly ChatMessage[]): GateUserMessage[] {
  return messages
    .filter((message) => message.role === "user")
    .reverse()
    .map((message) => ({
      text: message.text,
      peer: message.peer !== undefined,
      ...(message.author ? { author: message.author.id } : {}),
    }));
}

function unavailable(name: string): ToolExecutionResult {
  return {
    output: [{ type: "text", text: `${name} is not available on the Claude plan engine.` }],
    isError: true,
  };
}

/** The text Claude reads back from a tool's result. */
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
