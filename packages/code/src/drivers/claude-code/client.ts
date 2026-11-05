/**
 * The Code page's own socket to the Claude Code worker (separate from the
 * bot engine's). Pings every 20s and closes after 60s of silence, reconnects
 * with backoff (asking `resolveWorker` again, since the tunnel's port can
 * change), and resumes each session from the last `seq` it applied. Requests
 * still unanswered when a socket drops are sent again on the next one: the
 * worker makes the ones that matter idempotent (a send carries its uuid).
 */
import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import {
  DEFAULT_TIMINGS,
  parseCodingWorkerMessage,
  reconnectDelayMs,
  type CodingCatalog,
  type CodingClientMessage,
  type CodingEvent,
  type CodingHelloResult,
  type CodingResumeResult,
} from "@tiny-agents/claude-worker";

export interface CodingClientTimings {
  pingIntervalMs: number;
  silenceCloseMs: number;
  reconnectMinMs: number;
  reconnectMaxMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_CLIENT_TIMINGS: CodingClientTimings = {
  pingIntervalMs: DEFAULT_TIMINGS.pingIntervalMs,
  silenceCloseMs: DEFAULT_TIMINGS.silenceCloseMs,
  reconnectMinMs: DEFAULT_TIMINGS.reconnectMinMs,
  reconnectMaxMs: DEFAULT_TIMINGS.reconnectMaxMs,
  requestTimeoutMs: 60_000,
};

export type ClientState = "idle" | "connecting" | "connected" | "reconnecting";

export interface CodingClientHandlers {
  onEvent(sessionId: string, seq: number, event: CodingEvent): void;
  onPartial(
    sessionId: string,
    partial: { reset?: boolean; text?: string; thinking?: string },
  ): void;
  onCatalog(catalog: CodingCatalog): void;
  /** After every (re)connect. `rebooted`: the worker restarted, its sessions are gone. */
  onConnected(hello: CodingHelloResult, rebooted: boolean): void;
  onResume(sessionId: string, result: CodingResumeResult): void;
  onState(state: ClientState, detail?: string): void;
  onError?(message: string): void;
}

export class CodingRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CodingRequestError";
  }
}

/** A coding request without its id (the client adds one). */
type RequestBody = CodingClientMessage extends infer M
  ? M extends { requestId: string }
    ? Omit<M, "requestId">
    : never
  : never;

interface Pending {
  data: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cancelTimer: () => void;
}

export class CodingWorkerClient {
  private socket: WebSocket | undefined;
  private ready = false;
  private stopped = true;
  private attempt = 0;
  private lastRx = 0;
  private bootId: string | undefined;
  private reconnectTimer: (() => void) | undefined;
  private heartbeatTimer: (() => void) | undefined;
  private readonly pending = new Map<string, Pending>();
  private readonly seqs = new Map<string, number>();
  private readonly resuming = new Set<string>();
  private counter = 0;
  private stateNow: ClientState = "idle";
  private detailNow: string | undefined;
  private readonly timings: CodingClientTimings;

  constructor(
    private readonly resolveWorker: () => Promise<{ url: string; token: string }>,
    private readonly handlers: CodingClientHandlers,
    timings: Partial<CodingClientTimings> = {},
  ) {
    this.timings = { ...DEFAULT_CLIENT_TIMINGS, ...timings };
  }

  get state(): ClientState {
    return this.stateNow;
  }

  get detail(): string | undefined {
    return this.detailNow;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.setState("connecting");
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    this.reconnectTimer?.();
    this.heartbeatTimer?.();
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    socket?.close();
    for (const [id, pending] of this.pending) {
      pending.cancelTimer();
      pending.reject(new Error("The Claude Code connection was stopped."));
      this.pending.delete(id);
    }
    this.setState("idle");
  }

  /** Close the socket but keep reconnecting (tests: a dropped tunnel). */
  drop(): void {
    this.socket?.terminate();
  }

  /** Follow a session: replay what the worker buffered since the last applied event. */
  track(sessionId: string): void {
    if (!this.seqs.has(sessionId)) this.seqs.set(sessionId, 0);
    if (this.ready) this.resume(sessionId);
  }

  request<T>(
    body: RequestBody,
    timeoutMs = this.timings.requestTimeoutMs,
    onReply?: (result: unknown) => void,
  ): Promise<T> {
    if (this.stopped) {
      return Promise.reject(new Error("Claude Code is not connected (the harness is stopped)."));
    }
    this.counter += 1;
    const requestId = `r${this.counter}_${randomBytes(4).toString("hex")}`;
    const data = JSON.stringify({ ...body, requestId });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            this.ready
              ? "The Claude Code worker did not answer in time."
              : `Claude Code is not reachable${this.detailNow ? `: ${this.detailNow}` : "."}`,
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, {
        data,
        resolve: (value) => {
          onReply?.(value);
          resolve(value as T);
        },
        reject,
        cancelTimer: () => clearTimeout(timer),
      });
      if (this.ready) this.socket?.send(data);
    });
  }

  // --- connection -------------------------------------------------------------

  private setState(state: ClientState, detail?: string): void {
    if (this.stateNow === state && this.detailNow === detail) return;
    this.stateNow = state;
    this.detailNow = detail;
    this.handlers.onState(state, detail);
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    let target: { url: string; token: string };
    try {
      target = await this.resolveWorker();
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : String(error));
      return;
    }
    if (this.stopped) return;
    const socket = new WebSocket(target.url, {
      headers: { Authorization: `Bearer ${target.token}` },
    });
    this.socket = socket;
    this.lastRx = Date.now();
    const mark = () => {
      this.lastRx = Date.now();
    };
    socket.on("open", () => {
      mark();
      void this.hello(socket);
    });
    socket.on("message", (data: unknown) => {
      mark();
      this.onMessage(socket, String(data));
    });
    socket.on("pong", mark);
    socket.on("ping", mark);
    socket.on("unexpected-response", (_req, res) => {
      this.detailNow =
        res.statusCode === 401
          ? "The Claude Code worker refused the token."
          : `The Claude Code worker answered HTTP ${res.statusCode}.`;
      socket.terminate();
    });
    socket.on("error", (error: Error) => {
      if (!this.detailNow) this.detailNow = error.message;
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.ready = false;
      this.heartbeatTimer?.();
      this.scheduleReconnect(this.detailNow);
    });
    this.armHeartbeat(socket);
  }

  private async hello(socket: WebSocket): Promise<void> {
    this.counter += 1;
    const requestId = `hello${this.counter}`;
    const reply = new Promise<CodingHelloResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The Claude Code worker did not greet back."));
      }, this.timings.requestTimeoutMs);
      timer.unref?.();
      this.pending.set(requestId, {
        data: "",
        resolve: resolve as (value: unknown) => void,
        reject,
        cancelTimer: () => clearTimeout(timer),
      });
    });
    socket.send(JSON.stringify({ type: "coding.hello", requestId }));
    let hello: CodingHelloResult;
    try {
      hello = await reply;
    } catch (error) {
      this.detailNow = error instanceof Error ? error.message : String(error);
      socket.terminate();
      return;
    }
    if (this.socket !== socket || this.stopped) return;
    const rebooted = this.bootId !== undefined && this.bootId !== hello.bootId;
    this.bootId = hello.bootId;
    if (rebooted) for (const sessionId of this.seqs.keys()) this.seqs.set(sessionId, 0);
    this.ready = true;
    this.attempt = 0;
    this.setState("connected");
    for (const pending of this.pending.values()) {
      if (pending.data) socket.send(pending.data);
    }
    for (const sessionId of this.seqs.keys()) this.resume(sessionId);
    this.handlers.onConnected(hello, rebooted);
  }

  private scheduleReconnect(detail: string | undefined): void {
    if (this.stopped) return;
    this.reconnectTimer?.();
    this.setState(this.bootId ? "reconnecting" : "connecting", detail);
    const delay = reconnectDelayMs(this.attempt, this.timings);
    this.attempt += 1;
    const timer = setTimeout(() => {
      this.detailNow = detail;
      void this.open();
    }, delay);
    timer.unref?.();
    this.reconnectTimer = () => clearTimeout(timer);
  }

  private armHeartbeat(socket: WebSocket): void {
    this.heartbeatTimer?.();
    const timer = setInterval(() => {
      if (this.socket !== socket) {
        clearInterval(timer);
        return;
      }
      if (Date.now() - this.lastRx >= this.timings.silenceCloseMs) {
        this.detailNow = "The Claude Code worker went silent.";
        socket.terminate();
        return;
      }
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, this.timings.pingIntervalMs);
    timer.unref?.();
    this.heartbeatTimer = () => clearInterval(timer);
  }

  // --- messages ---------------------------------------------------------------

  private resume(sessionId: string): void {
    if (this.resuming.has(sessionId)) return;
    this.resuming.add(sessionId);
    const afterSeq = this.seqs.get(sessionId) ?? 0;
    // The replayed events follow the reply in the same burst of frames, so
    // the seq bookkeeping happens synchronously, before they are read.
    this.request<CodingResumeResult>(
      { type: "coding.resume", sessionId, afterSeq },
      undefined,
      (raw) => {
        const result = raw as CodingResumeResult;
        this.resuming.delete(sessionId);
        const current = this.seqs.get(sessionId) ?? 0;
        if (!result.known) this.seqs.set(sessionId, 0);
        else if (result.gap) this.seqs.set(sessionId, Math.max(current, result.firstSeq - 1));
        this.handlers.onResume(sessionId, result);
      },
    ).catch((error: unknown) => {
      this.resuming.delete(sessionId);
      this.handlers.onError?.(error instanceof Error ? error.message : String(error));
    });
  }

  private onMessage(socket: WebSocket, raw: string): void {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    const type = (value as { type?: unknown } | null)?.type;
    if (type === "ping") {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (typeof type !== "string" || !type.startsWith("coding.")) {
      // welcome, pong, bot-session events and errors are not ours.
      if (type === "error") {
        const message = (value as { message?: unknown }).message;
        if (typeof message === "string") this.handlers.onError?.(message);
      }
      return;
    }
    const message = parseCodingWorkerMessage(value);
    if (!message) return;
    switch (message.type) {
      case "coding.reply": {
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        pending.cancelTimer();
        if (message.ok) pending.resolve(message.result);
        else {
          pending.reject(
            new CodingRequestError(
              message.error?.code ?? "failed",
              message.error?.message ?? "The Claude Code worker refused the request.",
            ),
          );
        }
        return;
      }
      case "coding.event": {
        const last = this.seqs.get(message.sessionId) ?? 0;
        if (message.seq <= last) return;
        if (message.seq !== last + 1) {
          // Joined mid-stream or missed events: replay from what was applied.
          this.seqs.set(message.sessionId, last);
          this.resume(message.sessionId);
          return;
        }
        this.seqs.set(message.sessionId, message.seq);
        this.handlers.onEvent(message.sessionId, message.seq, message.event);
        return;
      }
      case "coding.partial":
        this.handlers.onPartial(message.sessionId, message);
        return;
      case "coding.catalog":
        this.handlers.onCatalog(message.catalog);
        return;
    }
  }
}
