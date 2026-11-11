/**
 * The Claude plan's model list, from Claude Code itself: the worker on the
 * sandbox asks the signed-in Claude Code which models it offers (its
 * `ModelInfo` list, each alias with the model it resolves to today). The app
 * never holds the login, so this is the only place the list can come from.
 */
import { claudeCodeModelsResultSchema, type ClaudeCodeModel } from "@tiny-agents/claude-worker";
import {
  connectWorker,
  type ConnectionTimings,
  type WebSocketLike,
  type WorkerTarget,
} from "@tiny-agents/claude-worker/client";

export type { ClaudeCodeModel } from "@tiny-agents/claude-worker";

const LIST_TIMEOUT_MS = 60_000;

export interface ListClaudeCodeModelsOptions {
  timeoutMs?: number;
  /** Test hooks. */
  timings?: Partial<ConnectionTimings>;
  connect?: (target: WorkerTarget) => WebSocketLike;
}

/**
 * One `models` request on a connection of its own, closed after the answer.
 * Throws with a readable reason (no sandbox, not signed in, no answer).
 */
export async function listClaudeCodeModels(
  resolveTarget: () => Promise<WorkerTarget>,
  options: ListClaudeCodeModelsOptions = {},
): Promise<ClaudeCodeModel[]> {
  const connection = connectWorker(resolveTarget, {
    sessions: { event: "event", resume: "resume", join: "now" },
    onMessage: () => {},
    ...(options.timings ? { timings: options.timings } : {}),
    ...(options.connect ? { socket: options.connect } : {}),
  });
  try {
    const result = await connection.request(
      { type: "models" },
      { timeoutMs: options.timeoutMs ?? LIST_TIMEOUT_MS },
    );
    const parsed = claudeCodeModelsResultSchema.safeParse(result);
    if (!parsed.success) throw new Error("The Claude worker sent an unreadable model list.");
    return parsed.data.models;
  } finally {
    connection.close();
  }
}
