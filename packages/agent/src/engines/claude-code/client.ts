/**
 * WebSocket client from tiny-agents to the Claude Code worker.
 * Ping every 20s, reconnect after silence, resume from the last sequence
 * number. Tool calls are idempotent on tool_use_id.
 */
import { WebSocket } from "ws";
import {
  DEFAULT_TIMINGS,
  parseWorkerMessage,
  reconnectDelayMs,
  type Timings,
  type ToolResultPayload,
  type WorkerMessage,
} from "@tiny-agents/claude-worker";

export interface ToolUseCall {
  sessionId: string;
  turnId: string;
  toolUseId: string;
  name: string;
  input: unknown;
}

export interface ClaudeWorkerClientOptions {
  url: string;
  token: string;
  timings?: Partial<Timings>;
  onEvent: (message: WorkerMessage) => void;
  onTool: (call: ToolUseCall) => Promise<ToolResultPayload>;
  /** Test hook. Defaults to the `ws` client. */
  connect?: (url: string, token: string) => WebSocketLike;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface WebSocketLike {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  ping?: () => void;
}

const OPEN = 1;

export class ClaudeWorkerClient {
  private socket: WebSocketLike | undefined;
  private attempt = 0;
  private stopped = false;
  private lastRx = 0;
  private readonly lastSeq = new Map<string, number>();
  private readonly inflight = new Set<string>();
  private readonly results = new Map<string, ToolResultPayload>();
  private readonly queued: string[] = [];
  private reconnectTimer: (() => void) | undefined;
  private heartbeatTimer: (() => void) | undefined;
  private readonly timings: Timings;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(private readonly options: ClaudeWorkerClientOptions) {
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings };
    this.now = options.now ?? Date.now;
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    this.lastRx = this.now();
    this.open();
  }

  /** Close the socket but keep reconnecting. Tests use this for a mid-turn drop. */
  drop(): void {
    this.socket?.close();
  }

  close(): void {
    this.stopped = true;
    this.reconnectTimer?.();
    this.heartbeatTimer?.();
    this.socket?.close();
    this.socket = undefined;
  }

  send(message: unknown): void {
    const data = JSON.stringify(message);
    if (this.socket && this.socket.readyState === OPEN) this.socket.send(data);
    else this.queued.push(data);
  }

  private open(): void {
    if (this.stopped) return;
    const connect =
      this.options.connect ??
      ((url: string, token: string) =>
        new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } }));
    const socket = connect(this.options.url, this.options.token);
    this.socket = socket;
    this.lastRx = this.now();
    const mark = () => {
      this.lastRx = this.now();
    };
    socket.on("open", () => {
      this.attempt = 0;
      mark();
      this.flush();
      this.resumeAll();
      this.armHeartbeat();
    });
    socket.on("message", (data: unknown) => {
      mark();
      this.onMessage(typeof data === "string" ? data : String(data));
    });
    socket.on("pong", mark);
    socket.on("ping", mark);
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.heartbeatTimer?.();
      this.scheduleReconnect();
    });
    socket.on("error", () => {
      socket.close();
    });
    this.armHeartbeat();
  }

  private armHeartbeat(): void {
    this.heartbeatTimer?.();
    const tick = () => {
      if (this.stopped) return;
      if (this.now() - this.lastRx >= this.timings.silenceCloseMs) {
        this.socket?.close();
        return;
      }
      this.socket?.ping?.();
      this.send({ type: "ping" });
      this.heartbeatTimer = this.schedule(tick, this.timings.pingIntervalMs);
    };
    this.heartbeatTimer = this.schedule(tick, this.timings.pingIntervalMs);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer?.();
    const delay = reconnectDelayMs(this.attempt, this.timings);
    this.attempt += 1;
    this.reconnectTimer = this.schedule(() => this.open(), delay);
  }

  private flush(): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    for (const data of this.queued.splice(0)) this.socket.send(data);
  }

  private resumeAll(): void {
    for (const [sessionId, seq] of this.lastSeq) {
      this.send({ type: "resume", sessionId, afterSeq: seq });
    }
  }

  private onMessage(raw: string): void {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const message = parseWorkerMessage(value);
    if (!message) return;
    if (message.type === "ping") {
      this.send({ type: "pong" });
      return;
    }
    if (message.type === "pong") return;
    this.options.onEvent(message);
    if (message.type !== "event") return;
    const previous = this.lastSeq.get(message.sessionId) ?? 0;
    if (message.seq <= previous) return;
    this.lastSeq.set(message.sessionId, message.seq);
    if (message.event.type === "tool_use") void this.onToolUse(message.sessionId, message.event);
  }

  private async onToolUse(
    sessionId: string,
    event: { turnId: string; toolUseId: string; name: string; input: unknown },
  ): Promise<void> {
    const cached = this.results.get(event.toolUseId);
    if (cached) {
      this.sendResult(sessionId, event.toolUseId, cached);
      return;
    }
    if (this.inflight.has(event.toolUseId)) return;
    this.inflight.add(event.toolUseId);
    try {
      const result = await this.options.onTool({ sessionId, ...event });
      this.results.set(event.toolUseId, result);
      this.sendResult(sessionId, event.toolUseId, result);
    } catch (error) {
      const result = {
        content: error instanceof Error ? error.message : String(error),
        isError: true,
      };
      this.results.set(event.toolUseId, result);
      this.sendResult(sessionId, event.toolUseId, result);
    } finally {
      this.inflight.delete(event.toolUseId);
    }
  }

  private sendResult(sessionId: string, toolUseId: string, result: ToolResultPayload): void {
    this.send({
      type: "tool_result",
      sessionId,
      toolUseId,
      content: result.content,
      ...(result.isError ? { isError: true } : {}),
    });
  }
}
