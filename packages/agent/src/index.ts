/**
 * @tiny-agents/agent — the only module in tiny-agents that touches pi-durable.
 *
 * The root is the pi-durable boundary: the runtime, the conversation and chat
 * types, the toolkits and capabilities bots run, and the gateway model
 * catalog, all through app-shaped types so pi-durable API churn stays
 * contained here. Areas that do not use pi-durable have their own subpaths:
 * `./sandbox` (the sandbox connection), `./terminal`, `./browser` and
 * `./computer` (live sessions and their transports), `./claude-worker` (the
 * worker on the sandbox), `./peer-envelope` (client-safe) and `./testing`.
 * The root exports only what something outside the package imports.
 * Child-only package: excluded from groot sync via
 * `.groot/boilerplate-sync.json` `additional_exclusions`.
 */
export {
  AgentRuntime,
  ApprovalNotPendingError,
  CredentialRequestNotPendingError,
  QuestionNotPendingError,
} from "./runtime";
export { finishedReplyOf, finishedReplyTo } from "./replies";
export { createToolSearchCapability, type Capability, type ToolPermission } from "./capabilities";
export { WaitTracker } from "./waiting";
export { createClassifier } from "./classifier";
export { createReviewer, type Reviewer } from "./reviewer";
export {
  SecretValue,
  VaultError,
  VaultTargetMovedError,
  type SecretField,
  type SecretValues,
  type VaultApproval,
  type VaultBroker,
  type VaultCard,
  type VaultItemMeta,
  type VaultKind,
  type VaultOutcome,
  type VaultTargetKind,
  type VaultPlan,
  type VaultUse,
} from "./vault";
export { secretRedactor } from "./redact";
export { type CredentialField, type CredentialRequest } from "./credentials";
export { createVaultToolkit } from "./toolkits/vault";
export { type SecretFillField } from "./toolkits/browser-fill";
export { InvalidAnswersError, MAX_ANSWER_TEXT } from "./toolkits/questions";
export { createTasksToolkit, type TaskRecord, type TaskStore } from "./toolkits/tasks";
export { createCodeToolkit, type CodeHandoffRecord, type CodeStore } from "./toolkits/code";
export { createTodayCapability } from "./toolkits/today";
export { createSandboxToolkit } from "./toolkits/sandbox";
export { createBotsToolkit, type BotMessagingStore } from "./toolkits/bots";
export {
  createAttachmentsToolkit,
  fence as fenceAttachment,
  stripAttachmentNotes,
  UNTRUSTED_RULE,
  type AttachmentContent,
  type AttachmentEntry,
  type AttachmentSheet,
  type AttachmentStatus,
  type AttachmentStore,
  type AttachmentSummary,
} from "./toolkits/attachments";
export { createBrowserToolkit } from "./toolkits/browser";
export { createComputerToolkit } from "./toolkits/computer";
export {
  createRoutinesToolkit,
  REPORT_ROUTINE_BLOCKED,
  type RoutineRecord,
  type RoutineSchedule,
  type RoutineStore,
  type RoutineUpdateInput,
} from "./toolkits/routines";
export { createVisionToolkit, createTranscriber, type VisionStore } from "./toolkits/vision";
export { sanitizePeerText } from "./toolkits/peer-text";
export { createSkillsCapability, SKILL_NAME, type SkillStore } from "./skills";
export {
  createMemoryCapability,
  MEMORY_CATEGORY_ORDER,
  MEMORY_HEADING,
  MEMORY_RENDER_CHAR_CAP,
  renderMemoryBlock,
  type MemoryLine,
  type MemoryStore,
} from "./toolkits/memory";
export { createSelfImproveCapability, type InstructionsStore } from "./toolkits/self-improve";
export {
  createBotBuilderCapability,
  type BotCreationRefusal,
  type BotCreationStore,
  type NewBotInput,
} from "./toolkits/bot-builder";
export { createWebToolkit } from "./toolkits/web";
export { checkPublicUrl } from "./toolkits/public-url";
export {
  connectMcp,
  createMcpCapability,
  MCP_DEFER_THRESHOLD,
  isUnauthorized,
  mcpAuth,
  mcpToolName,
  type McpCallResult,
  type McpConnection,
  type McpToolInfo,
  type McpTransportKind,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "./mcp";
export { GATEWAY_PROVIDER } from "./models";
export type { ModelCatalog, ModelRef } from "./model-catalog";
export { claudeCodeEngineEnabled } from "./engine";
export {
  windowChat,
  pageBefore,
  CHAT_WINDOW,
  authoredText,
  isSkipReply,
  SKIP_REPLY,
} from "./transcript";
export type * from "./types";
// Image preparation re-exports (issue #17): apps/web must not import
// pi-durable directly (PRD §7.2), so the Photon helpers flow through here.
export { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
export {
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
  type PreparedImage,
} from "@earendil-works/pi-durable/tools";
