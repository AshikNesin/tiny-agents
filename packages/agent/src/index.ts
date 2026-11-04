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
export { finishedReplyOf, finishedReplyTo, type TurnOutcome } from "./replies";
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
export {
  approvalOf,
  recordDecision,
  type ApprovalDecision,
  type ApprovalState,
  type ApprovalView,
  type GateHooks,
  type GatePlan,
} from "./approvals";
export {
  applyPermissions,
  compilePolicy,
  PermissionsDoc,
  resolveModelId,
  type CompiledPolicy,
  type Permissions,
} from "./policy";
export {
  ChatProjection,
  unansweredOf,
  type FoldOutcome,
  type ProjectionSnapshot,
} from "./projection";
export { refuseUnattended } from "./waiting";
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
  type VaultTargetKind,
  type VaultPlan,
  type VaultRefusal,
  type VaultUse,
} from "./vault";
export { REDACTED, SecretRedactor, secretRedactor } from "./redact";
export {
  CREDENTIAL_REQUEST_TTL_MS,
  credentialResultDetails,
  credentialsOf,
  pendingCredentialDetails,
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
export { ASK_OWNER, InvalidAnswersError, MAX_ANSWER_TEXT, questionsOf } from "./toolkits/questions";
export {
  createTasksExtension,
  createTasksToolkit,
  type TaskRecord,
  type TaskStore,
  type TaskStatus,
  type TaskPriority,
} from "./toolkits/tasks";
export {
  createShelleyToolkit,
  type ShelleyChangedFile,
  type ShelleyConversationStatus,
  type ShelleyHandoffRecord,
  type ShelleyModelRecord,
  type ShelleyStore,
  type ShelleyToolkitOptions,
} from "./toolkits/shelley";
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
  type Ssh2TerminalTransport,
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
  closeAllBrowserSessions,
  conversationBrowserTarget,
  createBrowserSessions,
  createBrowserToolkit,
  isBlockedPrivateUrl,
  normalizeCredentialRequest,
  type BrowserClock,
  type BrowserDriver,
  type BrowserOpenState,
  type BrowserPhase,
  type BrowserSession,
  type BrowserSessions,
  type BrowserSessionsOptions,
  type BrowserTarget,
  type BrowserToolkitOptions,
  type BrowserTransport,
  type BrowserVnc,
  type LiveBrowserSession,
  type LiveBrowserTab,
} from "./toolkits/browser";
export { createChromiumTransport } from "./toolkits/browser-chromium";
export {
  closeAllComputerSessions,
  createComputerSessions,
  createComputerToolkit,
  DesktopGoneError,
  normalizeKeys,
  OWNER_DRIVING,
  OwnerDrivingError,
  SHARED_COMPUTER_PROFILE,
  WindowMismatchError,
  windowTarget,
  type ComputerApp,
  type ComputerDesktop,
  type ComputerDriver,
  type ComputerOpenState,
  type ComputerPhase,
  type ComputerSessions,
  type ComputerSessionsOptions,
  type ComputerToolkitOptions,
  type ComputerTransport,
  type ComputerWindow,
  type LiveComputer,
  type OpenDesktopOptions,
  type WindowBinding,
} from "./toolkits/computer";
export {
  createX11ComputerTransport,
  type X11ComputerTransportOptions,
} from "./toolkits/computer-x11";
export { parseDesktopSize, parseExtraPackages } from "./toolkits/computer-vm-setup";

export {
  dialSsh,
  hostKeyHash,
  verifyHostKey,
  DEFAULT_SSH_PORT,
  DEFAULT_SSH_USER,
  type SshEndpoint,
} from "./ssh/connection";
export {
  createSandboxClaudeWorker,
  createExternalWorkerLocator,
  noWorkerLocator,
  type ClaudeAccountStatus,
  type ClaudeWorkerLocator,
  type ClaudeWorkerMode,
  type ClaudeWorkerTarget,
  type SandboxWorkerOptions,
} from "./engines/claude-code/sandbox-worker";
export {
  CLAUDE_WORKER_NODE_VERSION,
  CLAUDE_WORKER_PACKAGES,
  CLAUDE_WORKER_STACK_VERSION,
  claudeLoginShellLine,
} from "./engines/claude-code/sandbox-setup";
export {
  createRemoteCdpTransport,
  type RemoteCdpTransportOptions,
} from "./toolkits/browser-remote-cdp";
export {
  createRoutinesExtension,
  createRoutinesToolkit,
  confirmationCard,
  MAX_BLOCKED_REASON,
  REPORT_ROUTINE_BLOCKED,
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
  CLAUDE_OAUTH_TOKEN_MARKER,
  ClaudeOauthTokenError,
  GATEWAY_ENV_KEYS,
  GATEWAY_PROVIDER,
  aiProviderIds,
  assertNoClaudeOauthToken,
  builtinProviderIds,
  configuredProviderIds,
  createGatewayModels,
  createProviderModels,
  findClaudeOauthToken,
  isGatewayConfigured,
  primaryProviderId,
  providerSetupHint,
  type ProviderStatus,
} from "./models";
export {
  CLAUDE_CODE_MODEL_PREFIX,
  CLAUDE_PLAN_NOTE,
  claudeCodeBareModel,
  claudeCodeEngineEnabled,
  claudeCodeFallback,
  engineKindForConfig,
  engineKindForModel,
  type AgentEngine,
  type ClaudeEngineFallback,
} from "./engine";
export {
  deriveChat,
  diffChat,
  chatState,
  windowChat,
  pageBefore,
  CHAT_WINDOW,
  CHAT_USER_ENTRY,
  peerOf,
  attachmentsOf,
  queuedOf,
  authoredText,
  isSkipReply,
  SKIP_REPLY,
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
