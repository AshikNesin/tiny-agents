---
"@tiny-agents/agent": minor
"@groot/web": patch
---

Subpath exports for `@tiny-agents/agent`. The package root is now only the
pi-durable boundary (the runtime, the conversation and chat types, the
toolkits and capabilities, the gateway catalog), and exports only what
something outside the package imports: 328 named root exports become 105
(plus `export type * from "./types"`, unchanged). The areas that never touch
pi-durable get their own entry points, and the app imports them from there.
No behaviour changes; this is module layout only.

New subpaths:

- `@tiny-agents/agent/sandbox`: `createSandboxConnection`,
  `createMemoryHostKeyStore`, and the types `SandboxConnection`,
  `SandboxConnectionOptions`, `SandboxExecOptions`, `SandboxExecResult`,
  `SandboxFile`, `PtyStream`, `PtySize`, `HostKeyStore`, `SshEndpoint`.
- `@tiny-agents/agent/terminal`: `createTerminalService`, `parseSessionName`,
  `SessionBusyError`, `SessionLimitError`, `SessionNotFoundError`,
  `TerminalUnreachableError`, `TmuxMissingError`, and the types
  `TerminalService`, `TerminalServiceOptions`, `TerminalConnection`,
  `TerminalSessionRow`, `TerminalStatus`, `SessionName`, `PtyStream`.
- `@tiny-agents/agent/browser`: `createBrowserSessions`,
  `closeAllBrowserSessions`, `createChromiumTransport`,
  `createRemoteCdpTransport`, and the types `BrowserSessions`,
  `BrowserSessionsOptions`, `BrowserTarget`, `BrowserTransport`,
  `ChromiumTransportOptions` (new), `RemoteCdpTransportOptions`.
- `@tiny-agents/agent/computer`: `createComputerSessions`,
  `closeAllComputerSessions`, `createX11ComputerTransport`,
  `parseDesktopSize`, `parseExtraPackages`, and the types
  `ComputerSessions`, `ComputerSessionsOptions`, `ComputerTransport`,
  `X11ComputerTransportOptions`.
- `@tiny-agents/agent/claude-worker`: `createSandboxClaudeWorker`,
  `claudeLoginShellLine`, and the types `ClaudeWorkerLocator`,
  `ClaudeWorkerTarget`, `ClaudeAccountStatus`, `ClaudeWorkerMode`,
  `SandboxWorkerOptions`.

`createSandboxToolkit`, `createBrowserToolkit` and `createComputerToolkit`
need pi-durable and stay on the root. `./testing` and `./peer-envelope` are
unchanged; the server now imports `stripPeerEnvelope` from `./peer-envelope`
like the client does.

**Breaking** (`@tiny-agents/agent`): every name above is no longer exported
from the root; import it from its subpath. `parsePeerEnvelope`,
`stripPeerEnvelope` and `PeerEnvelope` are only on `./peer-envelope`.

Removed from the package's public surface (nothing outside the package
imported them; they stay exported from their source modules inside it):

- Runtime and store: `ConversationNotFoundError`, `ModelNotFoundError`,
  `AgentRuntimeOptions`, `TurnOutcome`, `StoreLockedError`,
  `acquireStoreLock`, `StoreLock`.
- Capabilities and policy: `defaultPermission`, `effectivePermission`,
  `CapabilityInfo`, `CapabilityKind`, `CapabilitySelection`, `ToolInfo`,
  `applyPermissions`, `compilePolicy`, `PermissionsDoc`, `resolveModelId`,
  `CompiledPolicy`, `Permissions`.
- Approvals, the Tool gate and the engine seam: `approvalOf`,
  `recordDecision`, `ApprovalDecision`, `ApprovalState`, `ApprovalView`,
  `GateHooks`, `GatePlan`, `ToolGate`, `GateCall`, `GateStore`,
  `ToolGateOptions`, `GateUserMessage`, `refuseUnattended`, `AgentEngine`,
  `CompiledConversation`, `EngineSubmission`, `ClaudeEngineFallback`,
  `CLAUDE_CODE_MODEL_PREFIX`, `CLAUDE_PLAN_NOTE`, `claudeCodeBareModel`,
  `claudeCodeFallback`, `engineKindForConfig`, `engineKindForModel`.
- Projection and transcript: `ChatProjection`, `unansweredOf`,
  `FoldOutcome`, `ProjectionSnapshot`, `deriveChat`, `diffChat`,
  `chatState`, `CHAT_USER_ENTRY`, `peerOf`, `attachmentsOf`, `queuedOf`,
  `RawChat`.
- Classifier and reviewer: `classifierFromModels`,
  `DEFAULT_CLASSIFIER_MODEL`, `Classifier`, `REVIEW_QUESTIONS`,
  `REVIEW_THRESHOLDS`, `ReviewEvent`, `ReviewInput`, `ReviewVerdict`.
- Vault, redaction and credentials: `GrantsDoc`, `VAULT_RULE`, `vaultGrant`,
  `VaultRefusal`, `REDACTED`, `SecretRedactor`,
  `CREDENTIAL_REQUEST_TTL_MS`, `credentialResultDetails`, `credentialsOf`,
  `pendingCredentialDetails`, `SECRET_FIELD_TYPES`, `CredentialFieldType`,
  `CredentialRequestOutcome`, `describeItem`, `VAULT_APPROVAL_TTL_MS`,
  `VaultToolkitOptions`, `OriginMismatchError`, `SecretFill`.
- Toolkits: `ASK_OWNER`, `questionsOf`, `createTasksExtension`,
  `TaskStatus`, `TaskPriority`, `CodeChangedFile`, `CodeHarnessRecord`,
  `CodeModelRecord`, `CodeThreadStatus`, `CodeToolkitOptions`,
  `TodayOptions`, `SandboxToolkitOptions`, `AttachmentsToolkitOptions`,
  `createRoutinesExtension`, `confirmationCard`, `MAX_BLOCKED_REASON`,
  `RoutineCreateInput`, `VISION_SYSTEM`, `DEFAULT_QUESTION`, `Transcriber`,
  `CUSTODY_RULE`, `SkillContent`, `SkillSummary`, `isPrivateAddress`,
  `WebToolkitOptions`, `UnauthorizedError`.
- Browser and computer internals: `conversationBrowserTarget`,
  `isBlockedPrivateUrl`, `normalizeCredentialRequest`, `BrowserClock`,
  `BrowserDriver`, `BrowserOpenState`, `BrowserPhase`, `BrowserSession`,
  `BrowserToolkitOptions`, `BrowserVnc`, `LiveBrowserSession`,
  `LiveBrowserTab`, `DesktopGoneError`, `normalizeKeys`, `OWNER_DRIVING`,
  `OwnerDrivingError`, `SHARED_COMPUTER_PROFILE`, `WindowMismatchError`,
  `windowTarget`, `ComputerApp`, `ComputerDesktop`, `ComputerDriver`,
  `ComputerOpenState`, `ComputerPhase`, `ComputerToolkitOptions`,
  `ComputerWindow`, `LiveComputer`, `OpenDesktopOptions`, `WindowBinding`.
- SSH, terminal and Claude worker internals: `SANDBOX_IDLE_TIMEOUT_MS`,
  `describeSandboxError`, `hostKeyHash`, `verifyHostKey`,
  `DEFAULT_SSH_PORT`, `DEFAULT_SSH_USER`, `ForwardRefusedError`,
  `HostKeyChangedError`, `PreDispatchError`, `SandboxTimeoutError`,
  `TMUX_INSTALL_COMMAND`, `TerminalExecResult`, `MAX_SESSIONS`,
  `SCROLLBACK`, `SESSION_PREFIX`, `TERM`, `TMUX_SOCKET`, `noWorkerLocator`,
  `CLAUDE_WORKER_NODE_VERSION`, `CLAUDE_WORKER_PACKAGES`,
  `CLAUDE_WORKER_STACK_VERSION`.
- Models: `CLAUDE_OAUTH_TOKEN_MARKER`, `ClaudeOauthTokenError`,
  `GATEWAY_ENV_KEYS`, `aiProviderIds`, `assertNoClaudeOauthToken`,
  `builtinProviderIds`, `configuredProviderIds`, `createGatewayModels`,
  `createProviderModels`, `findClaudeOauthToken`, `isGatewayConfigured`,
  `primaryProviderId`, `providerSetupHint`, `ProviderStatus`.
- pi-durable image re-exports: `ImageLimits`.

The package's own tests that used the root for internals
(`policy`, `projection`, `runtime` and `attachments` tests) import them from
their source modules, as the rest of `tests/server/app/agent` already does.

`checkPublicUrl` and `isPrivateAddress` move to `toolkits/public-url.ts`, so
no subpath loads pi-durable (`/browser` and `/claude-worker` reached it
through the web toolkit).
