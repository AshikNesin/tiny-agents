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
  timings?: Partial<ConnectionTimings>;
  connect?: (target: WorkerTarget) => WebSocketLike;
}

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
