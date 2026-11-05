/**
 * The slice of the Agent SDK (0.3.x) the coding mode uses, checked against
 * the published `sdk.d.ts`. Tests inject a fake; the worker VM loads the
 * real package. Unlike the bot engine, a coding session runs Claude Code's
 * own tools, settings and system prompt in the thread's working directory:
 * that is the point of the Code page. The lockdown that stays: no Claude
 * credential here, no `ANTHROPIC_BASE_URL`, overrides stripped from `env`.
 */
import { workerProcessEnv } from "./guards";
import {
  DEFAULT_CODING_PERMISSION_MODE,
  type CodingEffortLevel,
  type CodingHistoryMessage,
  type CodingPermissionMode,
} from "./coding-protocol";

/** `SDKUserMessage`, as this worker builds it (streaming input). */
export interface CodingSdkUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
  /** Persisted as the transcript entry's uuid (fork and history key on it). */
  uuid: string;
  /**
   * The CLI's command-queue priority. `next` folds the message into the
   * running turn between tool calls (steering); `later` waits for the turn
   * to end; `now` interrupts. Absent: the CLI's default.
   */
  priority?: "now" | "next" | "later";
}

/** `PermissionResult`. `updatedInput` is always sent on allow. */
export type CodingPermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };

/** `CanUseTool`, the fields this worker reads. */
export type CodingCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: unknown[];
    blockedPath?: string;
    decisionReason?: string;
    title?: string;
    displayName?: string;
    description?: string;
    toolUseID: string;
    agentID?: string;
  },
) => Promise<CodingPermissionResult>;

/** `Options`, the fields this worker sets. */
export interface CodingQueryOptions {
  cwd: string;
  tools: { type: "preset"; preset: "claude_code" };
  systemPrompt: { type: "preset"; preset: "claude_code" };
  /** Must include `project` for the repo's CLAUDE.md. */
  settingSources: Array<"user" | "project" | "local">;
  permissionMode: CodingPermissionMode;
  /** Required by the SDK for `bypassPermissions`; set only when the thread starts in it. */
  allowDangerouslySkipPermissions?: boolean;
  canUseTool: CodingCanUseTool;
  includePartialMessages: true;
  resume?: string;
  model?: string;
  effort?: CodingEffortLevel;
  env: Record<string, string>;
  stderr?: (data: string) => void;
}

/** An `SDKMessage`, loosely: the worker relays most of them as they are. */
export interface CodingSdkMessage {
  type: string;
  subtype?: string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  [key: string]: unknown;
}

/** `Query`, the methods this worker calls. */
export interface CodingQuery extends AsyncIterable<CodingSdkMessage> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  setPermissionMode(mode: CodingPermissionMode): Promise<void>;
  /** Live effort change (`{ effortLevel }`); older SDKs lack it and effort waits for a restart. */
  applyFlagSettings?(settings: Record<string, unknown>): Promise<void>;
  supportedCommands(): Promise<Array<{ name: string; description: string; argumentHint: string }>>;
  supportedModels?(): Promise<
    Array<{
      value: string;
      displayName: string;
      description: string;
      supportedEffortLevels?: string[];
    }>
  >;
  close(): void;
}

export interface CodingSdk {
  query(args: {
    prompt: AsyncIterable<CodingSdkUserMessage>;
    options: CodingQueryOptions;
  }): CodingQuery;
  getSessionMessages(
    sessionId: string,
    options?: { dir?: string; includeSystemMessages?: boolean },
  ): Promise<CodingHistoryMessage[]>;
  forkSession(
    sessionId: string,
    options?: { dir?: string; upToMessageId?: string; title?: string },
  ): Promise<{ sessionId: string }>;
}

export function buildCodingSdkOptions(input: {
  cwd: string;
  resume?: string;
  model?: string | null;
  effort?: CodingEffortLevel | null;
  permissionMode?: CodingPermissionMode | null;
  env: Record<string, string | undefined>;
  canUseTool: CodingCanUseTool;
  stderr?: (data: string) => void;
}): CodingQueryOptions {
  const env = workerProcessEnv(input.env);
  if ("ANTHROPIC_BASE_URL" in env) {
    throw new Error("Refusing to set ANTHROPIC_BASE_URL.");
  }
  const permissionMode = input.permissionMode ?? DEFAULT_CODING_PERMISSION_MODE;
  return {
    cwd: input.cwd,
    tools: { type: "preset", preset: "claude_code" },
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["user", "project", "local"],
    permissionMode,
    ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: input.canUseTool,
    includePartialMessages: true,
    ...(input.resume ? { resume: input.resume } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort } : {}),
    env,
    ...(input.stderr ? { stderr: input.stderr } : {}),
  };
}
