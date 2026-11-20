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
  resolveTarget: () => Promise<WorkerTarget>;
  onEvent: (message: WorkerMessage) => void;
  onTool: (call: ToolUseCall) => Promise<ToolResultPayload>;
  onConnected?: (rebooted: boolean) => void;
  timings?: Partial<ConnectionTimings>;
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
      sessions: { event: "event", resume: "resume", join: "now" },
      onMessage: (frame) => this.onMessage(frame),
      ...(options.onConnected ? { onConnected: options.onConnected } : {}),
      ...(options.timings ? { timings: options.timings } : {}),
      ...(connect ? { socket: (target) => connect(target.url, target.token) } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
    });
  }

  track(sessionId: string): void {
    this.connection.track(sessionId);
  }

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
