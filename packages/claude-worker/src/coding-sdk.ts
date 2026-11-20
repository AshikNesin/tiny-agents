import { workerProcessEnv } from "./guards";
import {
  DEFAULT_CODING_PERMISSION_MODE,
  type CodingEffortLevel,
  type CodingHistoryMessage,
  type CodingPermissionMode,
} from "./coding-protocol";

export interface CodingSdkUserMessage {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
  uuid: string;
  priority?: "now" | "next" | "later";
}

export type CodingPermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };

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

export interface CodingQueryOptions {
  cwd: string;
  tools: { type: "preset"; preset: "claude_code" };
  systemPrompt: { type: "preset"; preset: "claude_code" };
  settingSources: Array<"user" | "project" | "local">;
  permissionMode: CodingPermissionMode;
  allowDangerouslySkipPermissions?: boolean;
  canUseTool: CodingCanUseTool;
  includePartialMessages: true;
  resume?: string;
  model?: string;
  effort?: CodingEffortLevel;
  env: Record<string, string>;
  stderr?: (data: string) => void;
}

export interface CodingSdkMessage {
  type: string;
  subtype?: string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  [key: string]: unknown;
}

export interface CodingQuery extends AsyncIterable<CodingSdkMessage> {
  interrupt(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  setPermissionMode(mode: CodingPermissionMode): Promise<void>;
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

export function codingSdkOf(module: {
  query: CodingSdk["query"];
  getSessionMessages?: CodingSdk["getSessionMessages"] | undefined;
  forkSession?: CodingSdk["forkSession"] | undefined;
}): CodingSdk | undefined {
  const { query, getSessionMessages, forkSession } = module;
  if (typeof getSessionMessages !== "function" || typeof forkSession !== "function") {
    return undefined;
  }
  return { query, getSessionMessages, forkSession };
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
