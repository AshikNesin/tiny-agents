/**
 * @tiny-agents/agent — the only module in tiny-agents that touches pi-durable.
 *
 * The root is the pi-durable boundary: the runtime, the conversation and chat
 * types and the toolkits and capabilities bots run, all through app-shaped
 * types so pi-durable API churn stays contained here. Provider accounts and
 * the Model catalog live in `@tiny-agents/models`; the runtime takes its
 * `ModelCatalog` from there. The sandbox connection, terminal, browser and
 * computer sessions and their transports live in `@tiny-agents/sandbox`; the
 * toolkits here drive them. Areas that do not use pi-durable have their own
 * subpaths: `./claude-worker` (the worker on the sandbox), `./peer-envelope`
 * (client-safe) and `./testing`; `./sandbox`, `./terminal`, `./browser` and
 * `./computer` only re-export `@tiny-agents/sandbox`, deprecated.
 * The root exports only what something outside the package imports.
 * Child-only package: excluded from groot sync via
 * `.groot/boilerplate-sync.json` `additional_exclusions`.
 */
export {
  AgentRuntime,
  ApprovalNotPendingError,
  CredentialRequestNotPendingError,
  ModelUnavailableError,
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
// Moved to @tiny-agents/sandbox (rewrite step 3.4). Re-exported so importers
// of this root keep compiling; nothing in this repo imports them from here.
export type {
  /** @deprecated Import from `@tiny-agents/sandbox/browser`. */
  SecretFillField,
} from "@tiny-agents/sandbox/browser";
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
export {
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  checkPublicUrl,
  /** @deprecated Import from `@tiny-agents/sandbox`. */
  isPrivateAddress,
} from "@tiny-agents/sandbox";
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
// Moved to @tiny-agents/models (rewrite step 3.3). Re-exported so importers of
// this root keep compiling; nothing in this repo imports them from here.
export {
  /** @deprecated Import from `@tiny-agents/models`. */
  discoverModels,
  /** @deprecated Import from `@tiny-agents/models`. */
  DiscoveryError,
  /** @deprecated Import from `@tiny-agents/models`. */
  gatewayCustomBaseUrl,
  /** @deprecated Import from `@tiny-agents/models`. */
  PROVIDER_KINDS,
  /** @deprecated Import from `@tiny-agents/models`. */
  PROVIDER_TEMPLATES,
  /** @deprecated Import from `@tiny-agents/models`. */
  resolveCapabilities,
  /** @deprecated Import from `@tiny-agents/models`. */
  testClassifierCall,
  /** @deprecated Import from `@tiny-agents/models`. */
  testModelCall,
  /** @deprecated Import from `@tiny-agents/models`. */
  testUnsavedModel,
} from "@tiny-agents/models";
export type {
  /** @deprecated Import from `@tiny-agents/models`. */
  AgentEngineKind,
  /** @deprecated Import from `@tiny-agents/models`. */
  CatalogModel,
  /** @deprecated Import from `@tiny-agents/models`. */
  CredentialResolver,
  /** @deprecated Import from `@tiny-agents/models`. */
  DiscoveredModel,
  /** @deprecated Import from `@tiny-agents/models`. */
  DiscoveryGet,
  /** @deprecated Import from `@tiny-agents/models`. */
  GatewayCustomProvider,
  /** @deprecated Import from `@tiny-agents/models`. */
  ModelCatalog,
  /** @deprecated Import from `@tiny-agents/models`. */
  ModelConfig,
  /** @deprecated Import from `@tiny-agents/models`. */
  ModelRole,
  /** @deprecated Import from `@tiny-agents/models`. */
  ModelRoute,
  /** @deprecated Import from `@tiny-agents/models`. */
  ModelRow,
  /** @deprecated Import from `@tiny-agents/models`. */
  ModelUnavailableReason,
  /** @deprecated Import from `@tiny-agents/models`. */
  ProviderAccount,
  /** @deprecated Import from `@tiny-agents/models`. */
  ProviderKind,
  /** @deprecated Import from `@tiny-agents/models`. */
  ProviderStatus,
  /** @deprecated Import from `@tiny-agents/models`. */
  ProviderSummary,
  /** @deprecated Import from `@tiny-agents/models`. */
  ProviderTemplate,
  /** @deprecated Import from `@tiny-agents/models`. */
  TestResult,
} from "@tiny-agents/models";
export {
  windowChat,
  pageBefore,
  CHAT_WINDOW,
  authoredText,
  isSkipReply,
  SKIP_REPLY,
} from "./transcript";
export type * from "./types";
export { RUN_TOOL_CALL_LIMIT } from "./gate";
// Image preparation re-exports (issue #17): apps/web must not import
// pi-durable directly (PRD §7.2), so the Photon helpers flow through here.
export { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
export {
  DEFAULT_IMAGE_LIMITS,
  type ImageProcessor,
  type PreparedImage,
} from "@earendil-works/pi-durable/tools";
