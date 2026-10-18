/**
 * @tiny-agents/agent — the only module in tiny-agents that touches pi-durable.
 *
 * Everything the app needs (durable bot conversations, chat streams, bot
 * activity, the gateway model catalog, capabilities and approvals) is exposed
 * through app-shaped types so pi-durable API churn stays contained here.
 * Child-only package: excluded from groot sync via
 * `.groot/boilerplate-sync.json` `additional_exclusions`.
 */
export {
  AgentRuntime,
  ApprovalNotPendingError,
  ConversationNotFoundError,
  ModelNotFoundError,
  type AgentRuntimeOptions,
} from "./runtime";
export { StoreLockedError, acquireStoreLock, type StoreLock } from "./lock";
export {
  createToolSearchCapability,
  defaultPermission,
  effectivePermission,
  type Capability,
  type CapabilityInfo,
  type CapabilityKind,
  type CapabilitySelection,
  type ToolInfo,
  type ToolPermission,
} from "./capabilities";
export type { ApprovalDecision } from "./approvals";
export {
  createTasksExtension,
  createTasksToolkit,
  type TaskRecord,
  type TaskStore,
  type TaskStatus,
  type TaskPriority,
} from "./toolkits/tasks";
export { createTimeToolkit, type TimeToolkitOptions } from "./toolkits/time";
export {
  createBotsToolkit,
  type BotMessagingStore,
} from "./toolkits/bots";
export {
  createSkillsCapability,
  SKILL_NAME,
  type SkillContent,
  type SkillStore,
  type SkillSummary,
} from "./skills";
export { createWebToolkit, checkPublicUrl, type WebToolkitOptions } from "./toolkits/web";
export {
  connectMcp,
  createMcpCapability,
  MCP_DEFER_THRESHOLD,
  isUnauthorized,
  mcpAuth,
  mcpToolName,
  UnauthorizedError,
  type McpCallResult,
  type McpConnection,
  type McpToolInfo,
  type McpTransportKind,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "./mcp";
export {
  GATEWAY_ENV_KEYS,
  GATEWAY_PROVIDER,
  createGatewayModels,
  isGatewayConfigured,
} from "./models";
export { deriveChat, diffChat, chatState, type RawChat } from "./transcript";
export type * from "./types";
