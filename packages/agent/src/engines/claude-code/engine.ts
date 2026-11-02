/**
 * Claude plan engine. Turns go to the worker over the WebSocket client.
 * The kill switch is read here, on each turn, from the environment: turning
 * it off does not redeploy or stop the worker. Transcripts for these
 * conversations live here, beside the pi-durable harness.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolResultPayload, ToolSpec, WorkerMessage } from "@tiny-agents/claude-worker";
import {
  claudeCodeEngineEnabled,
  claudeCodeFallback,
  type ClaudeEngineFallback,
} from "../../engine";
import { pageBefore } from "../../transcript";
import type {
  ChatEvent,
  ChatMessage,
  ChatPage,
  ChatState,
  ChatSubscription,
  ChatToolCall,
  ConversationRef,
} from "../../types";
import {
  createClaudeApprovalGate,
  type ClaudeApprovalGate,
  type ToolPermissionChoice,
} from "./approvals";
import { ClaudeWorkerClient, type ToolUseCall, type WebSocketLike } from "./client";
import { pauseMessage } from "./errors";

const TASK_ID_BASE = 2_000_000_000;

export interface ClaudeSessionSync {
  model: string;
  system: string;
  tools: ToolSpec[];
  permissions: Record<string, ToolPermissionChoice>;
}

export interface ClaudeSubmitInput {
  requestId: string;
  text: string;
  images?: { data: string; mimeType: string }[];
}

export interface ClaudeCodeEngineOptions {
  env?: () => Readonly<Record<string, string | undefined>>;
  /** JSON file for session ids and transcripts. Omitted for `:memory:` stores. */
  persistPath?: string;
  onBusy?: (ref: ConversationRef, busy: boolean) => void;
  execute: (ref: ConversationRef, call: ToolUseCall) => Promise<ToolResultPayload>;
  /** When set, tests skip the real socket. */
  connect?: (url: string, token: string) => WebSocketLike;
}

interface Listener {
  ref: ConversationRef;
  listener: (events: ChatEvent[]) => void | Promise<void>;
  window?: number;
}

interface LiveTurn {
  turnId: string;
  assistantId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface ClaudeSession {
  model: string;
  system: string;
  tools: ToolSpec[];
  permissions: Record<string, ToolPermissionChoice>;
  claudeSessionId?: string;
  /** `pi` after a gateway fallback latches the conversation onto the harness. */
  surface: "claude" | "pi";
  messages: ChatMessage[];
  nextTask: number;
  busy: boolean;
  live?: LiveTurn;
  gate: ClaudeApprovalGate;
}

export class ClaudeCodeEngine {
  private readonly sessions = new Map<ConversationRef, ClaudeSession>();
  private readonly listeners = new Set<Listener>();
  private client: ClaudeWorkerClient | undefined;
  private readonly env: () => Readonly<Record<string, string | undefined>>;
  private loaded = false;

  constructor(private readonly options: ClaudeCodeEngineOptions) {
    this.env = options.env ?? (() => process.env);
  }

  handles(ref: ConversationRef): boolean {
    return this.sessions.get(ref)?.surface === "claude";
  }

  ownsTask(taskId: number): boolean {
    if (taskId < TASK_ID_BASE) return false;
    for (const session of this.sessions.values()) {
      if (session.gate.owns(taskId)) return true;
    }
    return false;
  }

  sync(ref: ConversationRef, info: ClaudeSessionSync): void {
    const session = this.ensure(ref);
    session.model = info.model;
    session.system = info.system;
    session.tools = info.tools;
    session.permissions = info.permissions;
    if (session.surface !== "pi") session.surface = "claude";
  }

  /** The bot left the Claude plan model. Later turns use pi. */
  detach(ref: ConversationRef): void {
    const session = this.sessions.get(ref);
    if (!session) return;
    session.surface = "pi";
  }

  /**
   * Send one turn. `gateway` means the caller should submit the same input
   * through the pi harness. `ran` means this engine owns the transcript,
   * including a pause error when the kill switch or the worker refused.
   */
  async submit(ref: ConversationRef, input: ClaudeSubmitInput): Promise<"ran" | "gateway"> {
    await this.restore();
    const session = this.sessions.get(ref);
    if (!session || session.surface !== "claude") return "gateway";
    const env = this.env();
    const fallback = claudeCodeFallback(env);
    if (!claudeCodeEngineEnabled(env)) {
      return this.unavailable(
        ref,
        session,
        fallback,
        "Claude subscription engine is off (CLAUDE_CODE_ENGINE_ENABLED).",
      );
    }
    const url = env.CLAUDE_WORKER_URL?.trim();
    const token = env.CLAUDE_WORKER_TOKEN?.trim();
    if (!url || !token) {
      return this.unavailable(
        ref,
        session,
        fallback,
        "Claude subscription engine has no CLAUDE_WORKER_URL or CLAUDE_WORKER_TOKEN.",
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
    };
    const assistantId = `a-${turnId}`;
    const assistant: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      status: "streaming",
      model: `claude-code/${session.model}`,
      createdAt: Date.now(),
    };
    session.messages.push(user, assistant);
    session.busy = true;
    this.options.onBusy?.(ref, true);
    this.emit(ref);
    const done = new Promise<void>((resolve, reject) => {
      session.live = { turnId, assistantId, resolve, reject };
    });
    this.socket(url, token).send({
      type: "turn",
      sessionId: String(ref),
      turnId,
      text: input.text,
      model: session.model,
      system: session.system,
      ...(session.claudeSessionId ? { resume: session.claudeSessionId } : {}),
      tools: session.tools,
      ...(input.images?.length ? { images: input.images } : {}),
    });
    await done;
    await this.persist();
    return "ran";
  }

  abort(ref: ConversationRef): void {
    const session = this.sessions.get(ref);
    if (!session?.live) return;
    this.client?.send({ type: "abort", sessionId: String(ref) });
    this.finish(session, session.live.turnId, "aborted");
  }

  decide(taskId: number, decision: "approved" | "denied"): void {
    for (const session of this.sessions.values()) {
      if (!session.gate.owns(taskId)) continue;
      session.gate.decide(taskId, decision);
      return;
    }
    throw new Error(`Tool call ${taskId} is not waiting for approval`);
  }

  async read(ref: ConversationRef, window?: number): Promise<ChatState> {
    await this.restore();
    return this.state(this.require(ref), window);
  }

  async page(ref: ConversationRef, before: string, limit: number): Promise<ChatPage | undefined> {
    await this.restore();
    return pageBefore(this.require(ref).messages, before, limit);
  }

  watch(
    ref: ConversationRef,
    listener: (events: ChatEvent[]) => void | Promise<void>,
    window?: number,
  ): ChatSubscription {
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
    workerHost?: string;
  } {
    const env = this.env();
    const url = env.CLAUDE_WORKER_URL?.trim();
    let workerHost: string | undefined;
    if (url) {
      try {
        workerHost = new URL(url).host;
      } catch {
        workerHost = undefined;
      }
    }
    return {
      enabled: claudeCodeEngineEnabled(env),
      fallback: claudeCodeFallback(env),
      configured: Boolean(url && env.CLAUDE_WORKER_TOKEN?.trim()),
      ...(workerHost ? { workerHost } : {}),
    };
  }

  async close(): Promise<void> {
    this.client?.close();
    await this.persist();
  }

  private unavailable(
    ref: ConversationRef,
    session: ClaudeSession,
    fallback: ClaudeEngineFallback,
    detail: string,
  ): "ran" | "gateway" {
    if (fallback === "gateway") {
      session.surface = "pi";
      return "gateway";
    }
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
    return "ran";
  }

  private socket(url: string, token: string): ClaudeWorkerClient {
    if (this.client) return this.client;
    this.client = new ClaudeWorkerClient({
      url,
      token,
      connect: this.options.connect,
      onEvent: (message) => this.onWorker(message),
      onTool: (call) => this.onTool(call),
    });
    return this.client;
  }

  private async onTool(call: ToolUseCall): Promise<ToolResultPayload> {
    const ref = Number(call.sessionId);
    const session = this.sessions.get(ref);
    if (!session) return { content: "Unknown conversation.", isError: true };
    const tool: ChatToolCall = {
      id: call.toolUseId,
      name: call.name,
      args: asRecord(call.input),
      status: "running",
    };
    this.upsertTool(session, call.turnId, tool);
    this.emit(ref);
    return session.gate.run({
      toolUseId: call.toolUseId,
      name: call.name,
      input: call.input,
      turnId: call.turnId,
    });
  }

  private bindGate(ref: ConversationRef, session: ClaudeSession): ClaudeApprovalGate {
    return createClaudeApprovalGate({
      permission: (name) => session.permissions[name] ?? "ask",
      nextTaskId: () => {
        session.nextTask += 1;
        return session.nextTask;
      },
      onAsk: (call) => {
        this.upsertTool(session, call.turnId, {
          id: call.toolUseId,
          name: call.name,
          args: asRecord(call.input),
          status: "awaiting_approval",
          taskId: call.taskId,
        });
        this.emit(ref);
      },
      execute: async (call) => {
        this.upsertTool(session, call.turnId, {
          id: call.toolUseId,
          name: call.name,
          args: asRecord(call.input),
          status: "running",
        });
        this.emit(ref);
        try {
          const result = await this.options.execute(ref, {
            sessionId: String(ref),
            turnId: call.turnId,
            toolUseId: call.toolUseId,
            name: call.name,
            input: call.input,
          });
          this.upsertTool(session, call.turnId, {
            id: call.toolUseId,
            name: call.name,
            args: asRecord(call.input),
            status: result.isError ? "error" : "done",
            output: result.content,
          });
          this.emit(ref);
          return result;
        } catch (error) {
          const content = error instanceof Error ? error.message : String(error);
          this.upsertTool(session, call.turnId, {
            id: call.toolUseId,
            name: call.name,
            args: asRecord(call.input),
            status: "error",
            output: content,
          });
          this.emit(ref);
          return { content, isError: true };
        }
      },
    });
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
    if (index >= 0) tools[index] = { ...tools[index], ...tool };
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
      permissions: {} as Record<string, ToolPermissionChoice>,
      surface: "claude" as const,
      messages: [] as ChatMessage[],
      nextTask: TASK_ID_BASE,
      busy: false,
    };
    const withGate = session as ClaudeSession;
    withGate.gate = this.bindGate(ref, withGate);
    this.sessions.set(ref, withGate);
    return withGate;
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
        if (this.sessions.has(ref)) continue;
        const restored = { ...value, busy: false, live: undefined } as ClaudeSession;
        restored.gate = this.bindGate(ref, restored);
        this.sessions.set(ref, restored);
      }
    } catch {
      // No file yet.
    }
  }

  private async persist(): Promise<void> {
    if (!this.options.persistPath) return;
    const sessions: Record<string, ClaudeSession> = {};
    for (const [ref, session] of this.sessions) {
      sessions[String(ref)] = { ...session, live: undefined, busy: false };
    }
    await mkdir(dirname(this.options.persistPath), { recursive: true });
    await writeFile(this.options.persistPath, JSON.stringify({ sessions }), "utf8");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  return { value };
}
