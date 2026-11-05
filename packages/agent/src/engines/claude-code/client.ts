/**
 * The Claude plan engine's protocol on the Worker connection
 * (`@tiny-agents/claude-worker/client`): turns go out, session events come
 * in, and each `tool_use` runs here once. Tool calls are idempotent on
 * tool_use_id. Heartbeats, reconnects, resume and reboot detection are the
 * connection's.
 */
import {
  parseWorkerMessage,
  type ToolResultPayload,
  type WorkerMessage,
} from "@tiny-agents/claude-worker";
import {
  connectWorker,
  type ConnectionTimings,
  type WebSocketLike,
  type WorkerClock,
  type WorkerConnection,
  type WorkerTarget,
} from "@tiny-agents/claude-worker/client";

export type { WebSocketLike } from "@tiny-agents/claude-worker/client";

export interface ToolUseCall {
  sessionId: string;
  turnId: string;
  toolUseId: string;
  name: string;
  input: unknown;
}

export interface ClaudeWorkerClientOptions {
  /** Where the worker is; asked again on every reconnect. */
  resolveTarget: () => Promise<WorkerTarget>;
  /** Session events (once each, in order) and the worker's errors. */
  onEvent: (message: WorkerMessage) => void;
  onTool: (call: ToolUseCall) => Promise<ToolResultPayload>;
  /**
   * After every (re)connect, before queued turns go out. `rebooted`: the
   * worker restarted, and turns it was running are gone.
   */
  onConnected?: (rebooted: boolean) => void;
  timings?: Partial<ConnectionTimings>;
  /** Test hook. Defaults to the `ws` client. */
  connect?: (url: string, token: string) => WebSocketLike;
  clock?: WorkerClock;
}

export class ClaudeWorkerClient {
  private readonly connection: WorkerConnection;
  private readonly inflight = new Set<string>();
  private readonly results = new Map<string, ToolResultPayload>();

  constructor(private readonly options: ClaudeWorkerClientOptions) {
    const { connect } = options;
    this.connection = connectWorker(options.resolveTarget, {
      // A bot session's events belong to the turn the engine just sent:
      // joining at the live edge never replays (and re-runs) an old turn.
      sessions: { event: "event", resume: "resume", join: "now" },
      onMessage: (frame) => this.onMessage(frame),
      ...(options.onConnected ? { onConnected: options.onConnected } : {}),
      ...(options.timings ? { timings: options.timings } : {}),
      ...(connect ? { socket: (target) => connect(target.url, target.token) } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
    });
  }

  /** Follow a session's events (call before its first turn is sent). */
  track(sessionId: string): void {
    this.connection.track(sessionId);
  }

  /** True when it went out now; false when it waits for the next connection. */
  send(message: unknown): boolean {
    return this.connection.send(message as object);
  }

  close(): void {
    this.connection.close();
  }

  private onMessage(frame: unknown): void {
    const message = parseWorkerMessage(frame);
    if (!message) return;
    this.options.onEvent(message);
    if (message.type === "event" && message.event.type === "tool_use") {
      void this.onToolUse(message.sessionId, message.event);
    }
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
