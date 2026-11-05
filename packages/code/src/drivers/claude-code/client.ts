/**
 * The Code page's protocol (`coding.*`) on its own Worker connection
 * (`@tiny-agents/claude-worker/client`), separate from the bot engine's.
 * `coding.hello` is the handshake: it subscribes the socket to coding events
 * and lists the sessions the worker holds. Requests are typed here;
 * heartbeats, reconnects (asking `resolveWorker` again), resume, reboot
 * detection and re-sending unanswered requests are the connection's.
 */
import {
  parseCodingWorkerMessage,
  type CodingCatalog,
  type CodingClientMessage,
  type CodingEvent,
  type CodingHelloResult,
  type CodingResumeResult,
} from "@tiny-agents/claude-worker";
import {
  connectWorker,
  type ConnectionTimings,
  type WorkerConnection,
  type WorkerFrame,
  type WorkerTarget,
} from "@tiny-agents/claude-worker/client";

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

/** A coding request without its id (the connection adds one). */
type RequestBody = CodingClientMessage extends infer M
  ? M extends { requestId: string }
    ? Omit<M, "requestId">
    : never
  : never;

export class CodingWorkerClient {
  private connection: WorkerConnection | undefined;
  /** Sessions followed so far; a restart of the client follows them again. */
  private readonly tracked = new Set<string>();

  constructor(
    private readonly resolveWorker: () => Promise<WorkerTarget>,
    private readonly handlers: CodingClientHandlers,
    private readonly timings: Partial<ConnectionTimings> = {},
  ) {}

  get state(): ClientState {
    const state = this.connection?.state;
    return state === undefined || state === "closed" ? "idle" : state;
  }

  get detail(): string | undefined {
    return this.connection?.detail;
  }

  start(): void {
    if (this.connection) return;
    const connection = connectWorker(this.resolveWorker, {
      sessions: { event: "coding.event", resume: "coding.resume", join: "start" },
      hello: { type: "coding.hello" },
      onMessage: (frame) => this.onMessage(frame),
      onConnected: (rebooted, hello) =>
        this.handlers.onConnected(hello as CodingHelloResult, rebooted),
      onResume: (sessionId, result) => this.handlers.onResume(sessionId, result),
      onState: (state, detail) => {
        if (state !== "closed") this.handlers.onState(state, detail);
      },
      ...(this.handlers.onError ? { onError: this.handlers.onError } : {}),
      timings: this.timings,
    });
    this.connection = connection;
    for (const sessionId of this.tracked) connection.track(sessionId);
    this.handlers.onState("connecting");
  }

  stop(): void {
    const connection = this.connection;
    if (!connection) return;
    this.connection = undefined;
    connection.close();
    this.handlers.onState("idle");
  }

  /** Follow a session: replay what the worker buffered since the last applied event. */
  track(sessionId: string): void {
    this.tracked.add(sessionId);
    this.connection?.track(sessionId);
  }

  request<T>(body: RequestBody, timeoutMs?: number): Promise<T> {
    if (!this.connection) {
      return Promise.reject(new Error("Claude Code is not connected (the harness is stopped)."));
    }
    return this.connection.request<T>(body, timeoutMs === undefined ? {} : { timeoutMs });
  }

  private onMessage(frame: WorkerFrame): void {
    if (frame.type === "error") {
      // A bot-protocol error frame (a message the worker could not read).
      if (typeof frame.message === "string") this.handlers.onError?.(frame.message);
      return;
    }
    const message = parseCodingWorkerMessage(frame);
    if (!message) return;
    switch (message.type) {
      case "coding.event":
        this.handlers.onEvent(message.sessionId, message.seq, message.event);
        return;
      case "coding.partial":
        this.handlers.onPartial(message.sessionId, message);
        return;
      case "coding.catalog":
        this.handlers.onCatalog(message.catalog);
        return;
    }
  }
}
