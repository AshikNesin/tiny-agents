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
  createSandboxToolkit,
  createMemoryHostKeyStore,
  createSsh2Transport,
  type SandboxToolkitOptions,
  type SandboxTransport,
  type SandboxSession,
  type HostKeyStore,
} from "./toolkits/sandbox";
export { createBotsToolkit, type BotMessagingStore } from "./toolkits/bots";
export {
  browserOpenState,
  browserProfilesDir,
  closeAllBrowserSessions,
  closeBrowserSession,
  createBrowserToolkit,
  setDriver,
  startBrowserSession,
  getLiveBrowserSession,
  liveBrowserConversations,
  type BrowserToolkitOptions,
  type BrowserSession,
  type BrowserTransport,
  type BrowserDriver,
  type BrowserPhase,
  type BrowserVnc,
  type LiveBrowserSession,
} from "./toolkits/browser";
export { createChromiumTransport } from "./toolkits/browser-chromium";
export {
  createRemoteCdpTransport,
  type RemoteCdpTransportOptions,
} from "./toolkits/browser-remote-cdp";
export {
  createRoutinesExtension,
  createRoutinesToolkit,
  confirmationCard,
  type RoutineCreateInput,
  type RoutineRecord,
  type RoutineSchedule,
  type RoutineStore,
  type RoutineUpdateInput,
} from "./toolkits/routines";
export {
  createVisionToolkit,
  createTranscriber,
  VISION_SYSTEM,
  DEFAULT_QUESTION,
  type Transcriber,
  type VisionStore,
} from "./toolkits/vision";
export { sanitizePeerText, CUSTODY_RULE } from "./toolkits/peer-text";
export { parsePeerEnvelope, stripPeerEnvelope, type PeerEnvelope } from "./toolkits/peer-envelope";
export {
  createSkillsCapability,
  SKILL_NAME,
  type SkillContent,
  type SkillStore,
  type SkillSummary,
} from "./skills";
export { createMemoryCapability, type MemoryLine, type MemoryStore } from "./toolkits/memory";
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
export {
  deriveChat,
  diffChat,
  chatState,
  CHAT_USER_ENTRY,
  peerOf,
  attachmentsOf,
  type RawChat,
} from "./transcript";
export type * from "./types";
// Image preparation re-exports (issue #17): apps/web must not import
// pi-durable directly (PRD §7.2), so the Photon helpers flow through here.
export { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
export {
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
  type ImageLimits,
  type PreparedImage,
} from "@earendil-works/pi-durable/tools";
