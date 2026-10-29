/**
 * @tiny-agents/agent — the only module in tiny-agents that touches pi-durable.
 *
 * Everything the app needs (durable bot conversations, chat streams, bot
 * activity, the gateway model catalog, capabilities, approvals and questions
 * for the owner) is exposed
 * through app-shaped types so pi-durable API churn stays contained here.
 * Child-only package: excluded from groot sync via
 * `.groot/boilerplate-sync.json` `additional_exclusions`.
 */
export {
  AgentRuntime,
  ApprovalNotPendingError,
  ConversationNotFoundError,
  CredentialRequestNotPendingError,
  ModelNotFoundError,
  QuestionNotPendingError,
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
  classifierFromModels,
  createClassifier,
  DEFAULT_CLASSIFIER_MODEL,
  type Classifier,
} from "./classifier";
export {
  createReviewer,
  REVIEW_QUESTIONS,
  REVIEW_THRESHOLDS,
  type ReviewEvent,
  type Reviewer,
  type ReviewInput,
  type ReviewVerdict,
} from "./reviewer";
export {
  GrantsDoc,
  SecretValue,
  VAULT_RULE,
  VaultError,
  vaultGrant,
  type SecretField,
  type SecretValues,
  type VaultApproval,
  type VaultBroker,
  type VaultCard,
  type VaultItemMeta,
  type VaultKind,
  type VaultOutcome,
  type VaultPlan,
  type VaultRefusal,
  type VaultUse,
} from "./vault";
export { REDACTED, SecretRedactor, secretRedactor } from "./redact";
export {
  CREDENTIAL_REQUEST_TTL_MS,
  SECRET_FIELD_TYPES,
  type CredentialField,
  type CredentialFieldType,
  type CredentialRequest,
  type CredentialRequestOutcome,
} from "./credentials";
export { WaitTracker } from "./waiting";
export {
  createVaultToolkit,
  describeItem,
  VAULT_APPROVAL_TTL_MS,
  type VaultToolkitOptions,
} from "./toolkits/vault";
export {
  OriginMismatchError,
  type SecretFill,
  type SecretFillField,
} from "./toolkits/browser-fill";
export { ASK_OWNER, InvalidAnswersError, MAX_ANSWER_TEXT } from "./toolkits/questions";
export {
  createTasksExtension,
  createTasksToolkit,
  type TaskRecord,
  type TaskStore,
  type TaskStatus,
  type TaskPriority,
} from "./toolkits/tasks";
export { createTodayCapability, type TodayOptions } from "./toolkits/today";
export {
  createSandboxToolkit,
  createMemoryHostKeyStore,
  createSsh2Transport,
  type SandboxToolkitOptions,
  type SandboxTransport,
  type SandboxSession,
  type HostKeyStore,
} from "./toolkits/sandbox";
export {
  createTerminalService,
  SessionLimitError,
  SessionNotFoundError,
  SessionBusyError,
  TerminalUnreachableError,
  TmuxMissingError,
  TMUX_INSTALL_COMMAND,
  type TerminalService,
  type TerminalServiceOptions,
  type TerminalSessionRow,
  type TerminalStatus,
  type TerminalTransport,
  type TerminalExecResult,
  type PtyStream,
} from "./terminal/terminal";
export {
  createSsh2TerminalTransport,
  type Ssh2TerminalTransportOptions,
} from "./terminal/terminal-ssh2";
export {
  MAX_SESSIONS,
  SCROLLBACK,
  SESSION_PREFIX,
  TERM,
  TMUX_SOCKET,
  parseSessionName,
  type SessionName,
} from "./terminal/tmux";
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
  type AttachmentsToolkitOptions,
} from "./toolkits/attachments";
export {
  browserOpenState,
  browserProfilesDir,
  browserTabOrigin,
  fillSecretInBrowser,
  normalizeCredentialRequest,
  closeAllBrowserSessions,
  closeBrowserSession,
  conversationBrowserTarget,
  createBrowserToolkit,
  setDriver,
  startBrowserSession,
  getLiveBrowserSession,
  liveBrowserProfiles,
  type BrowserToolkitOptions,
  type BrowserSession,
  type BrowserTransport,
  type BrowserDriver,
  type BrowserPhase,
  type BrowserTarget,
  type BrowserVnc,
  type LiveBrowserSession,
  type LiveBrowserTab,
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
export {
  createWebToolkit,
  checkPublicUrl,
  isPrivateAddress,
  type WebToolkitOptions,
} from "./toolkits/web";
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
  queuedOf,
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
