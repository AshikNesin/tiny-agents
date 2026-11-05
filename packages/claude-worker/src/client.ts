/**
 * The app's side of the worker socket (`@tiny-agents/claude-worker/client`).
 * The bot engine and the Claude Code harness each put their protocol on a
 * `WorkerConnection`; the worker itself never imports this.
 */
export {
  DEFAULT_CONNECTION_TIMINGS,
  WorkerRequestError,
  connectWorker,
  type ConnectionTimings,
  type SessionStreams,
  type WebSocketLike,
  type WorkerClock,
  type WorkerConnection,
  type WorkerConnectionOptions,
  type WorkerConnectionState,
  type WorkerFrame,
  type WorkerTarget,
} from "./connection";
export type { ResumeResult } from "./envelope";
