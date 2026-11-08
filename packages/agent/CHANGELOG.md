# @tiny-agents/agent

## 1.0.0

### Major Changes

- [#213](https://github.com/AshikNesin/tiny-agents/pull/213) [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Models are owner data (issue [#179](https://github.com/AshikNesin/tiny-agents/issues/179), ADR 0016).
  
  - **Provider accounts and models are database rows.** Each account has a kind (Anthropic, OpenAI Chat, OpenAI Responses, Gemini, Cloudflare AI Gateway, Claude plan) and a key kept as an `app` vault item. Changes apply without a restart.
  - **Bots point at a model row**, not a string. The `custom:` and `claude-code/` id forms and the "primary provider" are gone. A bot without a model runs on the default model.
  - **Model roles** (`bot_default`, `memory_capture`, `chat_title`, `vision`, `classifier`) replace `DEFAULT_MODEL`, `MEMORY_CAPTURE_MODEL`, `CHAT_TITLE_MODEL`, `VISION_*` and `CLASSIFIER_MODEL`, and the hardcoded title, vision and classifier defaults.
  - **The Claude plan is a provider account.** It replaces `CLAUDE_CODE_ENGINE_ENABLED` and `CLAUDE_CODE_ENGINE_FALLBACK`; its fallback is a model.
  - **`@tiny-agents/agent`.** `AgentRuntime.open` takes `modelConfig` and `credentials` instead of `env` and `provider`; `applyModelConfig` replaces them while running. `ModelInfo` is `CatalogModel`; `createClassifier` and `createTranscriber` read roles from the runtime's catalog.
  - **Breaking.** `AI_PROVIDERS`, provider `*_API_KEY`s, `CLOUDFLARE_*`, `GATEWAY_*` and the variables above are no longer read. Set models up again; existing bots run on the default model until you pick one.

### Minor Changes

- [#213](https://github.com/AshikNesin/tiny-agents/pull/213) [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Settings → Models (issue [#179](https://github.com/AshikNesin/tiny-agents/issues/179), slice 4).
  
  - **Add models.** Connect a provider from a template or by kind, check which models its endpoint lists and keep the ones you want; or add a single model by id, test it, and add it. Keys go straight into the vault.
  - **Accounts and models.** Status, key hint, enable and disable, check again, edit the endpoint or key, delete (confirming first, then moving the bots that use it), per-model Test, and the Claude plan's fallback model.
  - **Default models.** Pick the model for new bots, memory capture, chat titles, image transcription and auto-review.
  - **Safe by default.** Creating, editing and deleting an account need step-up; discovery refuses private addresses unless the account allows them, follows no redirects and caps size and time; no route returns a key.
  - **`@tiny-agents/agent`.** `discoverModels`, `resolveCapabilities`, `PROVIDER_TEMPLATES` and `testModelCall` for the app's routes.

- [#213](https://github.com/AshikNesin/tiny-agents/pull/213) [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Vault items have an audience (issue [#179](https://github.com/AshikNesin/tiny-agents/issues/179), slice 2; ADR 0015).
  
  - **`app` items.** A secret the server uses itself, such as a model provider's key. Bots never list or use it; only the new `provider` sink resolves it, for a host the item lists. Successful uses aren't audited, and the value is cached in memory for up to five minutes.
  - **Policy binding.** A local item is bound to a digest of its policy (audience, origins, hosts, injection). Edits through the Vault UI re-seal it; widening an item's hosts in the database directly leaves its value unreadable.
  - **Vault page.** App items appear under "Used by the app" and can't be edited or deleted there.
  - **Breaking.** Local vault items stored before this change don't open: re-enter them.

### Patch Changes

- [#218](https://github.com/AshikNesin/tiny-agents/pull/218) [`56ada98`](https://github.com/AshikNesin/tiny-agents/commit/56ada985d0014bbaeea7c04ff1dd09e9a78d8d2f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - **Test** on a classifier model (Jev, Clef) in Settings → Models now makes one real classify call. It used to try a chat completion and always failed with "The model can't run (missing)", even though auto-review on the same model worked.

- [#220](https://github.com/AshikNesin/tiny-agents/pull/220) [`9f7db2a`](https://github.com/AshikNesin/tiny-agents/commit/9f7db2a01b2008d521aa9bfa2e77ab4270cea9a7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A gateway custom provider's model added by id (e.g. `custom-zai-coding-plan/glm-5.3`) no longer fails with an upstream's raw 404 page:
  
  - It goes to the custom provider's own gateway URL even before the provider is set up.
  - Its row in Settings → Models says when the provider isn't set up or has no base path.
  - **Custom providers** opens with the slug filled in.
  - Test explains an upstream 404 as a missing or wrong base path.

- [#217](https://github.com/AshikNesin/tiny-agents/pull/217) [`e7ef2e4`](https://github.com/AshikNesin/tiny-agents/commit/e7ef2e4abfd913cc54e6cdf312113c8e58b5611e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Models fixes from real use against Cloudflare AI Gateway (issues [#215](https://github.com/AshikNesin/tiny-agents/issues/215), [#216](https://github.com/AshikNesin/tiny-agents/issues/216)).
  
  - **Custom providers on the gateway ([#216](https://github.com/AshikNesin/tiny-agents/issues/216)).** A gateway account lists the custom providers configured in the gateway (slug and base path, e.g. `custom-zai-coding-plan`, `api/coding/paas/v4`). Their models appear beside Claude and the TypeSafe classifier in the same account, discovered through the gateway, and run on its token. Add them when connecting or from the card's **Custom providers**.
  - **Claude Sonnet 5.5 and Opus 5.5 work.** Calls without a thinking level (Test, chat titles, memory capture) no longer send `thinking: disabled`, which these models refuse.
  - **Clearer gateway models.** Workers AI catalog models are named `… (Workers AI)`; Test explains a missing BYOK key or Unified Billing credits (402) and a Workers Paid-only model (403).
  - **Settings → Models ([#215](https://github.com/AshikNesin/tiny-agents/issues/215)).** Reset stays inside the Default models card, and every model picker (default models, the Claude plan fallback, moving bots, the bot's model) is searchable.
- Updated dependencies [[`56ada98`](https://github.com/AshikNesin/tiny-agents/commit/56ada985d0014bbaeea7c04ff1dd09e9a78d8d2f)]:
  - @tiny-agents/claude-worker@0.4.1

## 0.5.0

### Minor Changes

- [#180](https://github.com/AshikNesin/tiny-agents/pull/180) [`1c4f612`](https://github.com/AshikNesin/tiny-agents/commit/1c4f612e91ce5e9aebc0eee5c2d28157b9d01800) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots can create a new bot when the owner asks (issue [#149](https://github.com/AshikNesin/tiny-agents/issues/149)): `create_bot` in the
  new `bot-builder` capability takes a name, a description, instructions and an
  optional model (the creating bot's by default). It always waits for the
  owner's approval, and is refused in routine runs, in turns started by another
  bot and in chats shared with guests. The approval card lists the new bot's
  description, model and full instructions. The input is checked with the New
  bot dialog's own schema, so a blank name is refused (`invalid`) with the
  dialog's message.

## 0.4.0

### Minor Changes

- [#187](https://github.com/AshikNesin/tiny-agents/pull/187) [`83ae1fd`](https://github.com/AshikNesin/tiny-agents/commit/83ae1fd3a967a9625171681c9d4059b3b3f65b47) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Every environment read goes through a validated env module, and lint rule R3
  (`repo/no-raw-env`) fails any other `process.env` read with a message naming
  `appEnv()`, core `env` and the schema.
  
  - `@tiny-agents/agent` no longer reads `process.env`. `AgentRuntime.open` and
    `ClaudeCodeEngine` read the `env` they are given (default empty), and
    `aiProviderIds`, `primaryProviderId`, `isGatewayConfigured`,
    `createProviderModels`, `registerGatewayCustomProviders`,
    `assertNoClaudeOauthToken`, `createClassifier` and `createTranscriber` take
    `env` as a required argument. The Node entry passes `process.env`.
  - `@tiny-agents/claude-worker`: `readClaudeAuth`, `requireSubscriptionLogin`
    and `createSdkQueryFactory` take `env` as a required argument, and
    `createClaudeWorkerServer` defaults it to empty. The worker's entry passes
    `process.env`.
  - `@groot/web`: the sandbox, browser, computer, TinyFish, TZ, SECRETS_KEY and
    Claude plan variables join the `appEnv()` schema, and the app reads them,
    SHELLEY_URL, ORIGIN and NODE_ENV only through `appEnv()` or core `env`.

### Patch Changes

- [#196](https://github.com/AshikNesin/tiny-agents/pull/196) [`75fbeb5`](https://github.com/AshikNesin/tiny-agents/commit/75fbeb5d0967630ae0a2465821d693648303ac9a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Deleting a bot releases everything it owned, listed in one table.
  
  - `@tiny-agents/agent`: `BrowserSessions.close(target, { wipeProfile: true })`
    wipes the profile even when no browser has it open. It removes the local
    profile dir, then calls the transport's new optional `wipe(profileDir)`
    (the sandbox VM transport deletes its copy there). `BrowserTransport` is
    now a callable interface carrying `wipe`, and `BrowserSession.wipeProfile`
    is gone. A failed wipe on the VM now fails the close instead of passing
    silently. An open that starts while a close is running waits for it, so a
    wipe never deletes the profile of a browser that is launching. A close
    clears the profile's last open error.
  - `@groot/web`: every per-bot resource has one entry in `BOT_RESOURCES`
    (`apps/web/src/server/api/bots/bot-resources.ts`), and `deleteBot` runs
    them all. A deleted bot's queued routine jobs are cancelled, its vault
    grants are dropped, and its own browser profile and desktop are wiped even
    after it switched to the shared browser. The delete answers without
    waiting for the browser and desktop releases on the sandbox VM; each
    failure is still logged with its resource kind.
  - `@groot/web`: Reset browser, on the chat panel and on the Browser page,
    deletes the local profile folder through the session manager (the local
    Chromium transport never deleted it itself). A failed wipe answers 502.

- [#191](https://github.com/AshikNesin/tiny-agents/pull/191) [`ae0099b`](https://github.com/AshikNesin/tiny-agents/commit/ae0099bfe7b438b19fd865ea839c73948afa41f9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Delete dead code, and fail CI on new dead code. `pnpm check:dead` runs knip
  and fails on any unused file, export or unresolved import. Its message says
  to add a file loaded by path to `entry` in `knip.json`, and otherwise to run
  `scripts/codemods/remove-dead-code.ts`, which deletes unused files only with
  `--remove-files`. Oxlint's `no-unused-vars` is now an error.
  
  - `@tiny-agents/agent`, `@tiny-agents/code`, `@tiny-agents/claude-worker`:
    unused exports inside the packages lose `export` or are deleted, including
    the deprecated `createGatewayModels` alias and `ClaudeEngineError`. No
    export reachable from a package's `exports` map changes.
  - `tiny-agents`: `pnpm db:generate` runs `drizzle-kit generate` alone.
    `apps/web/drizzle/index.ts`, which only the deleted Workers entry read, and
    `scripts/db-generate.ts`, which wrote it, are gone. The script is listed in
    `additional_exclusions`, so `pnpm groot:sync` never restores it.

- [#195](https://github.com/AshikNesin/tiny-agents/pull/195) [`80eb795`](https://github.com/AshikNesin/tiny-agents/commit/80eb79545ca683eb3db84ce44f0b01716cfea5c5) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Parse durable memo and document JSON once, at the toolkit boundary. Every
  read of a task memo or task document field that holds a structured value
  (`gate:plan`, `gate:review`, `vault:use`, the questions document's questions
  and answers, the credential request) now parses it with a zod schema in
  `packages/agent/src/durable-json.ts`, and a value of the wrong shape fails at
  once with an error naming its key. Writes copy the value to JSON with
  `toJson`, which drops undefined fields.
  
  - `@tiny-agents/agent`: no public export changes. `zod` is a new dependency.
    A pending vault card in a call's details shows only when it fits the
    `ChatVaultUse` shape, fields outside that shape are dropped, and a card
    that does not fit logs a warning naming `vault`.
  - `tiny-agents`: lint rule R6 (`repo/no-double-cast`) fails any `as unknown as`
    or `as any as` in `packages/agent/src` outside test helpers, with a message
    naming `durable-json.ts`. Rule R6b (`repo/no-never-cast`) fails `as never`
    there too; the gate now carries its hooks as `GateHooks<unknown>`.
- Updated dependencies [[`ae0099b`](https://github.com/AshikNesin/tiny-agents/commit/ae0099bfe7b438b19fd865ea839c73948afa41f9), [`83ae1fd`](https://github.com/AshikNesin/tiny-agents/commit/83ae1fd3a967a9625171681c9d4059b3b3f65b47)]:
  - @tiny-agents/claude-worker@0.4.0

## 0.3.0

### Minor Changes

- [#163](https://github.com/AshikNesin/tiny-agents/pull/163) [`89350a0`](https://github.com/AshikNesin/tiny-agents/commit/89350a09bf8ecc5949e381b5a9c27eed3315ab80) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Subpath exports for `@tiny-agents/agent`. The package root is now only the
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

- [#150](https://github.com/AshikNesin/tiny-agents/pull/150) [`e14a12f`](https://github.com/AshikNesin/tiny-agents/commit/e14a12f917572c757f115e31402748e080bad20c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Claude plan: set `CLAUDE_CODE_ENGINE_ENABLED=1`, sign in once, and use it.
  The app now installs and runs the Claude Code worker on the sandbox itself
  (the VM or the local container) over the same SSH endpoint as the browser and
  terminal: Node when needed, the pinned Agent SDK and Claude Code, the bundled
  worker (`dist/server/claude-worker.mjs`), started on the sandbox's loopback and
  reached through an SSH tunnel — no `tailscale serve`, token or unit file.
  Settings → Claude plan shows the setup and login state and opens a terminal tab
  running `claude auth login` to sign in (`POST /terminal/sessions` takes
  `run: "claude-login"`, the Terminal page takes `?tab=`). The local sandbox image
  preinstalls Claude Code. **Breaking:** the hand-run worker is gone —
  `CLAUDE_WORKER_URL`/`CLAUDE_WORKER_TOKEN`, the macOS/Linux worker guides and the
  systemd/launchd files are removed; the sandbox is the only path. The worker now
  starts without a login (each session checks it), and the launcher unsets
  API-key and backend overrides. See ADR 0010.

- [#163](https://github.com/AshikNesin/tiny-agents/pull/163) [`ff9c364`](https://github.com/AshikNesin/tiny-agents/commit/ff9c3643377ed3a0bc379f0b8690a6cd846f9ab7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One Worker connection for both Claude worker clients. `@tiny-agents/claude-worker/client`
  exports `connectWorker(resolveTarget, options)`, which owns the heartbeat and
  silence close, reconnecting with backoff (finding the worker again on every
  attempt), the handshake, worker restart detection by the `welcome` boot id, a
  resume cursor per session, requests and their replies (sent again on the next
  socket while unanswered), the queue while disconnected, and the wording of a
  refused token or an HTTP status. The Claude plan bot engine and the Claude Code
  harness are thin protocol layers on it.
  
  The worker's socket envelope is shared: `welcome` carries `bootId`, every
  request is answered with `reply` (was `coding.reply`), and the bot protocol's
  `resume` takes a `requestId` and answers where the session is before it
  replays.
  
  The Claude plan engine gains what only the harness had: it finds the worker
  again on every reconnect instead of caching its first address, and a worker
  restart ends the turn it was running with a visible error ("The Claude worker
  restarted…") instead of leaving the chat busy forever. A turn still waiting to
  be sent goes to the new worker. Its tool calls stay idempotent, and replaying
  an old turn never runs its tools again (bot sessions join at the worker's
  latest event).
  
  The worker labels `.avif` assets `image/avif`, matching the Code page.

- [#159](https://github.com/AshikNesin/tiny-agents/pull/159) [`1fc7691`](https://github.com/AshikNesin/tiny-agents/commit/1fc769128276b1c25b1e78f751d33de68fa10904) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code page harness adapters (issue [#157](https://github.com/AshikNesin/tiny-agents/issues/157), ADR 0011, ADR 0012): the Code page
  drives any coding agent through one adapter contract, starting with Shelley
  and Claude Code.
  
  `@tiny-agents/code` (new) holds the contract — `HarnessInstance`,
  `TranscriptItem` rows upserted by id, thread and instance events, honest
  `Capabilities`, `HarnessHost` — the drivers (`drivers/shelley`: Shelley's
  stream2, snapshot list, normalizer and usage report moved off the client;
  `drivers/claude-code`: Claude Code on the sandbox through the worker's coding
  mode), and a test kit (`capabilityProblems`, an in-memory thread index).
  
  `@groot/web` replaces the Shelley-only server code with a harness-generic
  layer: `code_threads` (followed/unread, and the index for harnesses without
  their own list) and `code_handoffs` (migration 0006, old Shelley rows copied
  at boot), one hub over every instance, a watcher that delivers hand-off
  finishes and pushes for any harness, and `/api/v1/code/*` routes
  (`/api/v1/shelley/*` is removed). The Code page renders the contract: a
  merged list with a harness filter, a harness picker for new threads, and
  controls that follow each harness's capabilities (approval and question
  cards, permission modes, steer/queue, recovery, Changes, usage).
  
  `@tiny-agents/agent` replaces the `shelley` toolkit with `code`:
  `code_start`/`code_send`/`code_status`/`code_list`/`code_models` (Shelley by
  default, any harness by name), keeping `shelley_start` and `shelley_send` as
  aliases; `ChatToolCall.shelley` becomes `ChatToolCall.code` (older results
  still parse).
  
  `@tiny-agents/claude-worker` adds the coding mode: Claude Code's built-in
  tools in a plain working directory, `acceptEdits` by default, approvals and
  questions through `canUseTool`, steer/queue/interrupt, history, fork and a
  fixed set of workspace operations, with its own concurrency budget.

- [#176](https://github.com/AshikNesin/tiny-agents/pull/176) [`bb9fec6`](https://github.com/AshikNesin/tiny-agents/commit/bb9fec6089651c66d975c919884be5690d0d4833) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One Model catalog owns model ids. `AgentRuntime.catalog` (`ModelCatalog`) lists
  the picker's models, says which ids a bot can run on (`has`), resolves an id to
  its registry model (`resolve`, `model`), gives one model's entry (`info`) and
  the providers' status (`providers`, `canAnswer`). It replaces
  `listModels()`, `hasModel()`, `providerStatus()` and `hasConfiguredProvider()`
  on the runtime, and `resolveModelId` in the policy module. The `custom:` and
  `claude-code/` grammar now lives only in `parseModelId`/`formatModelId`; the
  vision transcriber and Side-calls use it instead of their own parsers.
  
  A Claude plan bot's Side-calls (memory capture) run on the same model when a
  registry provider serves it, instead of always being skipped. Whether a bot's
  model sees images no longer depends on the picker's allowlist.

- [#163](https://github.com/AshikNesin/tiny-agents/pull/163) [`5563dcd`](https://github.com/AshikNesin/tiny-agents/commit/5563dcd9d3f3fde3f338d0150a426dba854866de) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One sandbox connection. Everything that reaches the sandbox VM (or the local
  sandbox container) now goes through one `SandboxConnection`
  (`createSandboxConnection(endpoint)`), built once in the app's composition
  root (`sandboxConnection()` in `sandbox-host.ts`) and handed to the sandbox
  toolkit, attachments, the terminal, the computer, the browser and the Claude
  worker. Its interface is `exec(cmd, { stdin, timeoutMs, maxBytes,
  settleOnExit })`, `pty(cmd, size)`, `readFile`, `writeFile`, `forward(port)`
  and `close()`. Behind it: one channel pool with a lazy shared dial, the
  defaults, TOFU host keys (unchanged), the pre-dispatch-only retry rule, the
  idle close (5 minutes), a closed forward retiring its connection (tailscaled
  stalls later channels on it), and one "Cannot reach the sandbox" wording.
  Attachments, the Claude worker, the computer's tool calls and the browser's
  setup and tunnels no longer pay a fresh SSH handshake per call or per socket.
  
  **Breaking** (`@tiny-agents/agent`): the toolkits and transports take
  `{ connection }` instead of host, port, user, host keys and key; the removed
  exports are `createSsh2Transport`, `SandboxTransport`, `SandboxSession`,
  `createSsh2TerminalTransport`, `Ssh2TerminalTransport(Options)`,
  `TerminalTransport` (now `TerminalConnection`) and `dialSsh`;
  `createSandboxClaudeWorker` takes `connection` instead of `endpoint` and
  `dial`.

- [#147](https://github.com/AshikNesin/tiny-agents/pull/147) [`f83139d`](https://github.com/AshikNesin/tiny-agents/commit/f83139da1ddcf6e9861b71ffab229c9e7fc5e757) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Share bots with guests (issue [#145](https://github.com/AshikNesin/tiny-agents/issues/145)): a collaborative chat where the owner and a
  guest write in the same conversation with a bot.
  
  `@groot/web` adds guests (Settings → People: name, email and a password the
  owner passes on) and per-bot sharing (bot settings → Sharing). A shared bot's
  chat is one conversation everybody in it sees live; each message shows its
  sender, and the bot reads it as `Name: message` with a prompt line naming
  everyone and asking it to reply `[skip]` when people only talk to each other
  (those replies are hidden and leave the Bot list alone). Guests reach only the
  bots shared with them (chat, approvals, Questions, live browser and computer
  views), uploads, Code and their own account; every other route answers 403
  (`guest.guard.ts`, default-deny). In a shared chat every vault use asks and
  only the owner may approve it, and memory capture and injection are off. New
  tables `guests` and `bot_guests` (migration 0005). Nothing changes until a
  guest is added: an account with no `guests` row is the owner.
  
  `@tiny-agents/agent` adds `ChatMessage.author` / `QueuedMessage.author` (the
  trusted sender, stored on the entry by `submit({ author })`, with the name
  prefix stripped from the transcript text), `authoredText`, `SKIP_REPLY` and
  `isSkipReply`.

- [#144](https://github.com/AshikNesin/tiny-agents/pull/144) [`07ef32e`](https://github.com/AshikNesin/tiny-agents/commit/07ef32ec5092a30c17e8668c1931b04867c705c2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add the Code page: a first-class workspace for the Shelley coding agent (issue [#143](https://github.com/AshikNesin/tiny-agents/issues/143)).
  
  `@groot/web` talks to Shelley's official HTTP/SSE API from the server only
  (`SHELLEY_URL`, the only setting; requests carry `X-Exedev-Userid` for an
  exe.dev Shelley's require-header guard): one
  `/api/stream2` connection (`ShelleyHub`) feeds the live conversation list,
  per-conversation streams, unread markers, Pushover pushes (`shelley.update`)
  and bot hand-off finishes. `/api/v1/shelley/*` is a curated allowlist of
  Shelley routes (lists, conversation, steer/queue/stop/retry/resume/fork,
  settings, background jobs, `@` file search, skills, uploads, git diffs,
  files and images). `/code` shows every conversation and subagent, a live
  transcript with per-tool rows (live bash output, patch diffs, subagent
  links, screenshots), the composer (steer, queue, `@` files, `/` commands,
  attachments, skills), model and reasoning switching, a context meter, cost,
  and a Changes panel with line comments. New tables `shelley_handoffs` and
  `shelley_seen` (migration 0004).
  
  `@tiny-agents/agent` adds the `shelley` toolkit (`shelley_start`,
  `shelley_send`, `shelley_status`, `shelley_list`, `shelley_models`; no tools
  without a store; start and send default to Allow via the new
  `ToolInfo.allowByDefault`)
  and `ChatToolCall.shelley`, the hand-off card a `shelley_start` result
  carries.

- [#152](https://github.com/AshikNesin/tiny-agents/pull/152) [`56c0bd5`](https://github.com/AshikNesin/tiny-agents/commit/56c0bd51e1de477542d21c2361c047686e32b6e1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Terminal: copy/paste that works and a steadier screen. Ctrl+V (and
  Ctrl+Shift+V, Shift+Insert, Cmd+V) now pastes from the browser, bracketed,
  even on plain-http pages; xterm used to turn Ctrl+V into ^V. Dragging over
  text in tmux copies it to the browser clipboard (tmux `set-clipboard on`
  plus an OSC 52 handler that accepts tmux's empty selection and refuses
  clipboard reads from the VM), with a "Copied" toast; Shift/Option+drag
  selects locally and Ctrl+C / Ctrl+Shift+C / Cmd+C copies it. Right-click
  opens a Copy / Paste / Select all menu, and the keys panel's paste is a
  real (bracketed) paste. Glitch fixes: unicode11 widths so emoji/CJK line up
  with tmux, truecolor through tmux, tabs attach at the rendered size (no
  120x34-then-resize redraw), a second browser tab or device no longer kicks
  the first off (no `attach -d`), the grid no longer widens its own column,
  hidden tabs never shrink the pty, and the terminal resets before a
  re-attach redraws. Pings run while the page is visible (no idle reconnect
  while reading; half-open sockets are detected) and the server pauses on
  client back-pressure. New: font size controls (A-/A+, Ctrl/Cmd +/-/0), a
  cols×rows badge while resizing, tuned light/dark ANSI palettes, Cmd/Ctrl+
  click links, and Reconnect after a detach.

- [#177](https://github.com/AshikNesin/tiny-agents/pull/177) [`18498d5`](https://github.com/AshikNesin/tiny-agents/commit/18498d57e533d3db6bbd812fa62cade3e18ad74a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One tool-call row for both engines. A tool call's chat row (its status,
  output, timing, approval and every Owner wait card) now comes from one
  projection, `tool-call-row.ts`, that the pi transcript and the Claude plan
  engine both use. On the Claude plan, a call waiting on a Question, a
  credential request or a takeover now shows that card instead of a bare
  "running" row, and a finished call shows its sources, Code hand-off,
  answers, credentials, takeover and clipped output as on pi. pi rows are
  unchanged.

- [#163](https://github.com/AshikNesin/tiny-agents/pull/163) [`c4759b1`](https://github.com/AshikNesin/tiny-agents/commit/c4759b13157722cac114bb5d24eb2f560dc880a1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One Tool gate for both bot engines (ADR 0014). A Claude plan tool call now
  goes through the same gate as a pi one: it is counted while it waits for your
  approval (the Bot list badge, push notifications), its result is scrubbed of
  vault values, auto-review can approve it, and vault cards and refusals from
  gate plans apply. YOLO mode reads one document for both engines, so a vault
  tool called without a vault item runs under YOLO on the Claude plan too, and a
  denied call shows as denied. Inside the package, `AgentEngine` is now a real
  per-conversation interface: `PiEngine` owns the pi-specific code and
  `AgentRuntime` only picks the engine (including the gateway fallback latch),
  holds the store and merges activity.

- [#177](https://github.com/AshikNesin/tiny-agents/pull/177) [`4ee6a86`](https://github.com/AshikNesin/tiny-agents/commit/4ee6a864e003e31faeb1a6848388f423456b7570) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Every vault sink goes through one use sequence.
  
  - `run_command` with `secrets` plans, asks, records and resolves through the
    shared vault sequence instead of calling the broker by hand:
    `vaultGatePlan` now takes several uses (`IntendedUses`: the uses, an
    `everyUse` flag, an optional sink rule checked after policy, extra card
    fields), and
    `useAllFromSink` resolves them nested, the way `useFromSink` (now its
    one-item form) does for one. The approval card is built by the shared plan:
    a single secret's card shows the item's real kind (and username for a
    login) instead of a fixed `api_key`; several secrets join their handles and
    labels as before; a long command is cut at 2000 characters on every card. A
    denied or expired command records against the uses the call was planned
    for.
  - New `VaultTargetMovedError` (root export, carries `actual` and the audit
    `reason`): `OriginMismatchError` and `WindowMismatchError` extend it.
    `useFromSink` turns one thrown by a sink into a `refused_origin`
    `VaultError` worded by the sink. The app checks `instanceof` instead of the
    error's name, so a desktop window that moved before typing is now audited as
    `refused_origin` ("active window changed before typing") instead of
    `sink_error`.
  - `resolveConnectionSecret` (MCP connection headers) runs the same internal
    path as `useItem`: one policy, audit, resolve and last-used step for both.
    The connection still receives the value, its audit rows and messages are
    unchanged.

- [#153](https://github.com/AshikNesin/tiny-agents/pull/153) [`501ed71`](https://github.com/AshikNesin/tiny-agents/commit/501ed71b7d370bf76c625f42a25eb6b7a3521705) Thanks [@AshikNesin](https://github.com/AshikNesin)! - YOLO mode (issue [#151](https://github.com/AshikNesin/tiny-agents/issues/151)): a per-chat switch in the chat header under which
  every tool call that would ask the owner runs without a card, including
  `askOnly` tools and cards already waiting when it is switched on. Vault uses
  always keep their card, and turns another bot or a guest started still ask.
  It lives in the conversation's new `tiny.yolo` document (`YoloDoc`), so a New
  chat starts with it off. The agent runtime adds `yolo(ref)` and
  `setYolo(ref, on, by)`; the gate records such calls as `approval: "yolo"`;
  `ToolInfo` gains a `vault` flag the Claude plan engine uses to keep vault
  sinks asking. The app adds `PUT /bots/:id/yolo` (owner only) and a `yolo`
  event on the bot's chat stream.

### Patch Changes

- [#162](https://github.com/AshikNesin/tiny-agents/pull/162) [`2cb4ea8`](https://github.com/AshikNesin/tiny-agents/commit/2cb4ea8e9fd925ccac5e662dc7ed203b1ca71727) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Auto-review: the classifier now defaults to `typesafe/jev` and calls Workers
  AI's `/accounts/{account}/ai/run` through the AI Gateway (`cf-aig-gateway-id`,
  with `CLOUDFLARE_API_KEY` as `Authorization`). Through the gateway, the old
  default `@cf/cloudflare/clef` bills against Unified Billing credits and, on the
  gateway's `workers-ai` route, so did Jev: without credits every review failed
  with 402 and the owner got every approval card. A failed review now logs a
  warning with its error.

- [#155](https://github.com/AshikNesin/tiny-agents/pull/155) [`756aa4b`](https://github.com/AshikNesin/tiny-agents/commit/756aa4b7d0ed378ed248b6d306c385b2e97e38d0) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Keep a Claude Code chat's history across a server restart. The runtime synced the conversation before the engine had read `agent.db.claude.json`, so the empty in-memory session shadowed the saved transcript (and the next save overwrote the file). The engine now merges the saved transcript and resume id into an already-synced session, reads the file before it ever writes it, and loads it before serving a chat watcher.
- Updated dependencies [[`e14a12f`](https://github.com/AshikNesin/tiny-agents/commit/e14a12f917572c757f115e31402748e080bad20c), [`ff9c364`](https://github.com/AshikNesin/tiny-agents/commit/ff9c3643377ed3a0bc379f0b8690a6cd846f9ab7), [`1fc7691`](https://github.com/AshikNesin/tiny-agents/commit/1fc769128276b1c25b1e78f751d33de68fa10904), [`721a473`](https://github.com/AshikNesin/tiny-agents/commit/721a473961c44b6a08d4360a192bede1d169d0c6)]:
  - @tiny-agents/claude-worker@0.3.0

## 0.2.0

### Minor Changes

- [#116](https://github.com/AshikNesin/tiny-agents/pull/116) [`7bb89a5`](https://github.com/AshikNesin/tiny-agents/commit/7bb89a5e0074c587192067032a45edf64cd140e0) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots can run on any pi-ai provider, not only the Cloudflare AI Gateway.
  `AI_PROVIDERS` lists provider ids in order (default `cloudflare-ai-gateway`),
  e.g. `openai` to call OpenAI directly with `OPENAI_API_KEY`, or
  `cloudflare-ai-gateway,openai` for both. The first provider's models keep bare
  ids; the others' read `custom:<provider>/<model>`. `createProviderModels`
  replaces `createGatewayModels` (kept as an alias), and the runtime gains
  `providerStatus()` and `hasConfiguredProvider()`, which the models endpoint
  returns as `providers` with a setup hint per provider. Once any provider has
  credentials, unconfigured providers' models are no longer listed. Model
  infos carry the serving provider's name.

- [`998668e`](https://github.com/AshikNesin/tiny-agents/commit/998668e8f9612c282ce193f838bf826eab50c602) Thanks [@claude](https://github.com/claude)! - Bots can ask the owner clarifying questions mid-reply (human in the loop).
  The new `ask_owner` tool (runtime-installed `questions` capability, read-only)
  takes 1–4 questions with optional options and multiple choice, and waits
  durably — the approval gate's wait, now shared as `waitForOwner`/`WaitTracker`
  in `waiting.ts` — until `AgentRuntime.answerQuestions` records the answers or
  a dismissal; `dismissQuestions` and `pendingQuestions` cover the rest, and
  `ActivityChange.questions` counts waiting calls. Transcript tool calls gain
  the `awaiting_answer` status and `questions`/`answers`. App side: every bot
  gets the toolkit, `POST /bots/:id/questions/:taskId` answers or dismisses,
  an owner message dismisses waiting questions so it is read right after, the
  bot list carries a `questions` count for the sidebar badge, and the chat
  renders the questions with the shadcn Questionnaire. Faux mode asks sample
  questions on "/ask".

- [#66](https://github.com/AshikNesin/tiny-agents/pull/66) [`4285c60`](https://github.com/AshikNesin/tiny-agents/commit/4285c608210820ec2720debb143cac1b9caa09f1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add auto-review (issue [#65](https://github.com/AshikNesin/tiny-agents/issues/65)): a per-bot switch that lets a classifier approve
  low-risk "Ask" tool calls the owner clearly asked for, so they run without an
  approval card. The reviewer can only remove a card, never deny: a call it does
  not approve, a classifier error or a timeout shows the card as before. Vault
  uses and askOnly tools always ask, and so do turns another bot started. The
  classifier reads the bot's instructions, the owner's latest messages and the
  pending call, never tool results.
  
  The agent package gains `Classifier` / `createClassifier` (Workers AI
  classifiers through pi-ai: Clef by default, any other via `CLASSIFIER_MODEL`,
  e.g. `typesafe/jev`), `createReviewer`, the `reviewer` runtime option and
  `CapabilitySelection.autoReview`. Gated results of auto-approved calls carry
  `approval: "auto"`, and chat tool calls show it. The schema adds
  `Bot.autoReview` (default off). New env var: `CLASSIFIER_MODEL`. See
  docs/features/auto-review.md.

- [#50](https://github.com/AshikNesin/tiny-agents/pull/50) [`28cc58f`](https://github.com/AshikNesin/tiny-agents/commit/28cc58f724801d5afa28b275e7cd5ca4d4a919c1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Deepen bot delivery and reply reading (architecture review):
  
  - Every message put in front of a bot (owner sends, mentions, relayed
    replies, bot-to-bot `message_bot`, routine fires) now goes through one
    module, `bots.conversation.ts`, which reconciles the durable conversation
    with the bot row before submitting. `message_bot` previously skipped the
    reconcile, and a routine whose bot model was removed retried forever
    instead of pausing, because the reconcile ran outside its error handling.
  - `AgentRuntime.finishedReplies(ref)` returns a conversation's finished
    assistant replies (none while busy), with `error` set on a model failure.
    The bot-to-bot relay and the routine completion watcher both use it. The
    watcher previously looked for a "⚠" prefix that chat messages never carry,
    so a routine run whose reply failed stayed "awaiting".
  - Owner sends that write a `chat.user` entry (attachments, peer deliveries)
    record their request id, exposed as `ChatMessage.requestId`. The chat
    store uses it to confirm optimistic echoes, so a send with a file no longer
    leaves a duplicate pending bubble next to the server-annotated message.
  - The sidebar approvals badge updates while a bot is still replying.
  - The real and faux runtime boots share their post-open wiring.

- [`1d8cb7a`](https://github.com/AshikNesin/tiny-agents/commit/1d8cb7acd10802cf1d430eb38829f844c7e5c2cd) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bot-to-bot messaging toolkit (issue [#12](https://github.com/AshikNesin/tiny-agents/issues/12)): the new `createBotsToolkit(store)` adds a `message_bot(to, text)` tool plus a roster prompt section listing the other bots. The app injects a `BotMessagingStore` that owns delivery; the tool derives `sourceKey` and `requestId` from the durable tool task (the `tasks` idempotency key), so pi-durable replays deliver exactly once.

- [`7147d40`](https://github.com/AshikNesin/tiny-agents/commit/7147d406ca552b24cea73277b38c93170b715aa9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bot-to-bot communication (issue [#12](https://github.com/AshikNesin/tiny-agents/issues/12)): tag a bot with @ in any composer and
  it receives an attributed copy of the message; its reply relays back into
  the host chat as "Reply from <name>". A new "bots" toolkit gives agents a
  message_bot(to, text) tool with the same relay back to the sender,
  loop-guarded (8 sends per pair per 10 minutes). Delivery is a BotMessage
  ledger (pending, delivered, answered) keyed by requestId and sourceKey so
  pi-durable tool replays and retried sends never duplicate a message.

- [`554fe18`](https://github.com/AshikNesin/tiny-agents/commit/554fe18aeeb803ec970a2e0f9065d6dd39f80e8a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A browser session manager and one SSH connection module.
  
  - `createBrowserSessions(options)` owns which browsers are live: lazy open,
    shared launches, the driver flag (action tools now wait on the owner's
    hand-back instead of polling), the idle sweep on an injectable clock, and
    `peek`, which never launches a browser. Closing a browser that is still
    opening cancels the open, so a reset or wipe can no longer come back as a
    browser that finished opening after it. The app creates one manager
    (`browser.sessions.ts`) and hands it to the toolkit (`sessions` option)
    and its routes; the module-level `startBrowserSession`, `setDriver`,
    `closeBrowserSession`, `closeBrowserTab`, `getLiveBrowserSession`,
    `browserOpenState`, `browserProfilesDir`, `liveBrowserProfiles`,
    `fillSecretInBrowser`, `browserTabOrigin` and `resetBrowserSessionsForTests`
    exports are gone (`closeAllBrowserSessions` stays and closes every
    manager). The vault sinks and the credential request sheet moved to
    `browser-vault.ts`; `browser-guard.ts` holds the ref and URL rules so the
    transports no longer import the toolkit. Gate plans no longer start a
    browser to plan a fill.
  - `ssh/connection.ts` is the one dial for the sandbox toolkit, the terminal
    and the browser's CDP tunnel: TOFU host-key pinning against one
    `HostKeyStore` (the CDP tunnel now pins too), an `error` listener that
    outlives the handshake (ssh2's second error after a timeout no longer
    crashes the server), the channel pool and `PreDispatchError`. The sandbox
    toolkit closes a pooled session that failed instead of dropping it with
    its keepalive running, and the terminal rebinds when the sandbox endpoint
    changes. The app reads one `sandboxEndpoint()` (host, port, user and one
    kv-backed key store under `SANDBOX`) for every SSH user; the terminal's
    separate `TERMINAL` pins are no longer written.

- [#25](https://github.com/AshikNesin/tiny-agents/pull/25) [`5bc76f2`](https://github.com/AshikNesin/tiny-agents/commit/5bc76f2e8a00227cc331067a8b4ed825fb1af8bf) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser as a first-class bot capability (issue [#24](https://github.com/AshikNesin/tiny-agents/issues/24)): a `browser` toolkit
  with seven gated tools (`browser_navigate`, `browser_snapshot`,
  `browser_click`, `browser_type`, `browser_press_key`, `browser_scroll`,
  `browser_screenshot`) driving one Chromium persistent context per bot
  profile (in-process Playwright, no debug port). The web app gains
  `/bots/:id/browser` routes: an MJPEG live view over a plain streaming
  response (JWT-cookie `<img>`, no WebSocket), a POST input channel that
  injects mouse/key events through the same CDP session the agent uses, a
  driver flag for takeover (action tools wait while the human drives; a
  masked secret field sends keystrokes straight into the page so values
  never enter model context, logs, or the transcript), and a profile-reset
  endpoint. Client: BrowserPanel docked beside the chat with live view,
  driver badge, take-control/release, and the masked field. `@groot/core`:
  the compression filter now also skips `multipart/x-mixed-replace` so the
  MJPEG stream is never buffered.

- [`16cfe00`](https://github.com/AshikNesin/tiny-agents/commit/16cfe00b63d9d8ffb29efc4e058d0290dc6e2b40) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser: full-control live view. With SANDBOX_HOST set, each bot's Chrome now
  runs headful on a private VNC display on the VM (installed automatically on
  first use) and the browser panel streams it with noVNC: real Chrome UI, mouse
  and keyboard, tabs, clipboard sync, full screen, a draggable panel width and a
  Retina-sharp canvas that fits its box. Taking control and releasing it keep
  the agent on whichever tab the owner left in front. VNC and CDP stay on
  127.0.0.1 on the VM; the WebSocket is guarded by one-time tickets. Deploys
  without SANDBOX_HOST get a headless browser for the bot and a panel that says
  there is no live view. Removed: the JPEG screencast and its `GET /browser/live`
  and `POST /browser/input` routes. New: `BROWSER_SCALE`,
  `POST /browser/start|vnc-ticket|resize`.

- [`514b6ef`](https://github.com/AshikNesin/tiny-agents/commit/514b6efda40bb2268920402a0f7260e06b6ba3da) Thanks [@AshikNesin](https://github.com/AshikNesin)! - First-class capabilities per bot (issue [#1](https://github.com/AshikNesin/tiny-agents/issues/1)): approvals, skills, toolkits and remote MCP.
  
  - **Capabilities:** `AgentRuntime.open` gains `capabilities` — a toolkit, the bot's skills or an MCP connection, each a pi-durable extension behind the approval gate, selected per conversation by `configure({ capabilities })`. `Allow · Ask · Off` per tool (`BotAgentConfig.capabilities`), with read-only tools defaulting to allow. `installCapability`/`uninstallCapability` hot-swap connections; `listCapabilities` describes them for the UI.
  - **Approvals:** an `ask` tool waits on a task-scoped approval document (`api.watchDoc`) and re-attaches after a restart; `decideApproval`/`pendingApprovals` answer and count them; the side effect of an unsafe tool never runs twice across a crash (memo-guarded). Chat events carry `ActivityChange.approvals`.
  - **Tool UI data:** `ChatMessage.toolCalls` now carry id, args, status (running/awaiting*approval/done/error/denied/interrupted/aborted), output, duration, sources (web tools) — built from `pi.tool-result` entries and live `tool_execution*\*` events.
  - **Toolkits:** `tasks` (moved to `toolkits/tasks`), `web` (Cloudflare Web Search API + Browser Rendering `/markdown`, SSRF-guarded, `CLOUDFLARE_API_BASE_URL` front door supported) and `time`.
  - **Skills:** the `skills` capability lists a bot's skills in a stable prompt section and serves `load_skill`/`read_skill_file`; `save_skill` is ask-only. `SKILL_NAME` validates Agent Skills naming.
  - **MCP:** `connectMcp` (Streamable HTTP with SSE fallback, `list_changed`, OAuth via `OAuthClientProvider`) and `createMcpCapability` (`mcp:<slug>`, tools `mcp__<slug>__<tool>`, replay from annotations). Depends on `@modelcontextprotocol/sdk` 1.29.0.
  
  App side (not a published package): Bot gains `toolkits`/`toolPermissions` (existing bots keep `tasks` via migration), Skill/BotSkill and Connection/BotConnection tables, `/api/v1/capabilities`, `/skills`, `/connections` (test, reconnect, authorize, OAuth callback, client metadata document), `POST /bots/:id/approvals/:taskId` with `alwaysAllow`, `SECRETS_KEY` (AES-256-GCM at-rest secrets) and a ConnectionManager that connects at boot without blocking readiness.

- [#110](https://github.com/AshikNesin/tiny-agents/pull/110) [`9a2224e`](https://github.com/AshikNesin/tiny-agents/commit/9a2224ecf1bd5a26aa2502365abdfae8ae725794) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Auto-review's classifier runs through the Cloudflare AI Gateway only, so every
  review shows up in the gateway's logs. It calls the gateway's `workers-ai`
  route with the same settings as chat models (`CLOUDFLARE_API_KEY` as
  `cf-aig-authorization`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`);
  without them auto-review stays off. Classifier ids read
  `cloudflare-ai-gateway/<model>`.

- [#117](https://github.com/AshikNesin/tiny-agents/pull/117) [`4814aca`](https://github.com/AshikNesin/tiny-agents/commit/4814aca75211052126f2dfdd163f16ebbb6d50f0) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Experimental Claude Pro/Max inference. Bots can select `claude-code/<model>`
  ("uses your Claude plan"). Turns go to a loopback worker that drives the
  official Claude Agent SDK. tiny-agents does not read, store, or refresh the
  Claude login, does not set `ANTHROPIC_BASE_URL`, and refuses to boot when
  model-provider config contains an `sk-ant-oat` token. `CLAUDE_CODE_ENGINE_ENABLED`
  is the kill switch. Default fallback is pause.

- [#111](https://github.com/AshikNesin/tiny-agents/pull/111) [`ceb61ee`](https://github.com/AshikNesin/tiny-agents/commit/ceb61eee088193ec8f487b2f6fecbd729d8a236b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Computer (issue [#108](https://github.com/AshikNesin/tiny-agents/issues/108)): every bot gets a desktop. With SANDBOX_HOST set, the
  first `computer_*` call (or "Open computer") installs XFCE, xdotool, scrot,
  xclip and wmctrl on the sandbox VM and starts an XFCE desktop per browser
  profile on its own Xtigervnc display, at a fixed size (`COMPUTER_DESKTOP_SIZE`,
  default 1280x800). The new `computer` toolkit sees with screenshots and acts
  with clicks, keys, typing, drags and scrolls in the same pixels (Anthropic's
  computer-use vocabulary): `computer_screenshot`, `computer_zoom`,
  `computer_click`, `computer_type`, `computer_key`, `computer_open_app`,
  windows, clipboard, `computer_wait`, `computer_request_takeover` and the vault
  sink `computer_fill_secret`. Every action answers with a fresh screenshot;
  effects ask first, and closing a window, closing shortcuts (alt+F4, ctrl+q,
  ctrl+w) and clipboard reads always ask. Typed text, clipboard text and vault
  values travel over stdin, never argv, and are never echoed. While the owner
  drives, actions wait and screenshots are refused. A bot can ask the owner to
  take over: the chat shows an "Action needed" card, the owner is notified, and
  the bot resumes from a screenshot once they hand back. A desktop left by a
  crash is reattached; one that died is relaunched on the next call.
  
  The chat gains a Computer panel (noVNC, scaled, never resized; take control,
  paste, full screen, reset) beside the Browser panel, routes
  `GET /bots/:id/computer`, `POST /bots/:id/computer/start|vnc-ticket|driver`
  and `DELETE /bots/:id/computer/profile`, and a `/bots/:id/computer/vnc`
  WebSocket; the browser's VNC bridge is now shared (`desktop.vnc.ts`). New
  chat tool status `awaiting_takeover`, vault target kind `window` (every use
  asks), and logins list `computer_fill_secret` by default. New optional env:
  `COMPUTER_DESKTOP_SIZE`, `COMPUTER_IDLE_MINUTES`, `COMPUTER_EXTRA_PACKAGES`.
  Without SANDBOX_HOST nothing changes: no tools offered, no panel toggle.

- [#49](https://github.com/AshikNesin/tiny-agents/pull/49) [`5c3262f`](https://github.com/AshikNesin/tiny-agents/commit/5c3262fc24846a01c669e93af9fe9cdeceddd680) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Every bot has every built-in toolkit (ADR 0004). The per-bot toolkit
  switches and the `toolkits` column are gone; a bot is shaped by its tool
  permissions alone (Off removes a tool), and effectful tools still ask first.
  Automatic capabilities (vision, tool search, today's date) are marked
  `auto` and hidden from the bot's settings, which also drops the Memory and
  Vision switches that did nothing. The `time` toolkit is replaced by
  `createTodayCapability`, a prompt line with today's date in the owner's
  timezone. Routines accept a relative `{ kind: "in", minutes }` schedule
  resolved by the tool, and their tool text is shorter. An unconfigured web
  toolkit offers the model no tools.

- [`2e60f7b`](https://github.com/AshikNesin/tiny-agents/commit/2e60f7ba3404b8bff5985ccf3a9828d7393c53c5) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Finished replies are matched to what they answer by request id, not by
  timestamps. `finishedReplyTo(state, requestId)` returns a submission's turn
  outcome (`answered` with the turn's last message, every refused tool and the
  newest blocked reason; `pending`; or `unknown`), so a mid-turn "Let me
  check…" never stands in for the answer and two queued submissions never swap
  replies. Every user message now records its submit request id on its entry
  (not only sends with attachments or peer attribution), so clients confirm an
  Echo by id. `lastMessage` and the diagnostics grouping read those entries as
  user messages too.

- [#115](https://github.com/AshikNesin/tiny-agents/pull/115) [`81a32ec`](https://github.com/AshikNesin/tiny-agents/commit/81a32ec6e152e8aea235fedf6b86146dd43068cf) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sandbox can be a local Docker container for machines that can't join
  the tailnet (docs/guides/local-sandbox.md). The shared SSH dial and every
  transport built on it (sandbox, attachments, terminal, browser, computer)
  take an optional `privateKey` for public-key auth; without one they dial
  keyless Tailscale SSH as before. The app reads it from SANDBOX_SSH_KEY_FILE or
  SANDBOX_SSH_KEY, and `pnpm sandbox:up` builds, keys and starts the container.

- [#67](https://github.com/AshikNesin/tiny-agents/pull/67) [`4b8a557`](https://github.com/AshikNesin/tiny-agents/commit/4b8a557bb85aef95dcbf4e2158f2fa3c601da23f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix memory capture and injection, and add forgetting from chat (issue [#64](https://github.com/AshikNesin/tiny-agents/issues/64)).
  Injection now keeps the newest memories as whole lines when the block passes
  6,000 characters, with an accurate omitted count; before, it cut the newest
  facts (and later categories) mid-sentence. `renderMemoryBlock` and its
  constants moved into `@tiny-agents/agent`, and `MemoryLine` gains `createdAt`.
  Turning memory back on starts capture from that moment, so nothing said while
  it was off is remembered. One capture reads at most the newest 24,000
  characters and still advances the watermark, so a long backlog no longer
  retries forever. `remember` is refused in routine runs and peer turns, even
  with Always allow, using the vault's `isUnattended` check (now shared in
  `bots.unattended.ts`). The capture prompt lists the 30 newest deleted
  memories, so they don't come back reworded. A new `forget({ text })` tool
  (default Ask, same refusals) tombstones the matching memories and returns
  what it removed.

- [`aa4adf8`](https://github.com/AshikNesin/tiny-agents/commit/aa4adf8db074e8398c5b3693759c5ed450ca0626) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bot-to-bot hardening from the OpenMausBot study (issues [#13](https://github.com/AshikNesin/tiny-agents/issues/13)-[#16](https://github.com/AshikNesin/tiny-agents/issues/16)):
  
  - Peer text passes a custody boundary: forged provenance openings
    ("**Message from the owner:**" typed by a bot) are neutralized before
    delivery, and the roster states that bot messages are information,
    never owner instructions or permission grants ([#13](https://github.com/AshikNesin/tiny-agents/issues/13)).
  - message_bot wording suppresses duplicate acknowledgements: relayed
    replies are already visible, so the model is told not to re-send or
    thank ([#14](https://github.com/AshikNesin/tiny-agents/issues/14)).
  - The roster marks teammates that are mid-reply "(working right now)",
    and message_bot reports "queued behind their current reply" when the
    target is busy ([#15](https://github.com/AshikNesin/tiny-agents/issues/15)).
  - A reply may message at most 3 bots per turn (on top of the 10-minute
    pair window); replays of the same requestId are not charged, and going
    idle resets the budget. Refusals tell the model what to do next ([#16](https://github.com/AshikNesin/tiny-agents/issues/16)).

- [`554fe18`](https://github.com/AshikNesin/tiny-agents/commit/554fe18aeeb803ec970a2e0f9065d6dd39f80e8a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Three deep modules replace logic that was spread across the runtime, the
  gate, the toolkits and the transcript:
  
  - **Owner wait.** Each wait kind (approval, Question, credential request)
    owns its document, the card details the chat renders (`approvalOf`,
    `questionsOf`, `credentialsOf` parse what the same file produces), the
    host-side answer (`recordDecision`, `recordAnswers`, `readPendingRequest` /
    `settleRequest`) and the not-pending error. One `refuseUnattended` serves
    every kind, so a refused `ask_owner` now carries `approval: "refused"` and
    a Routine run sees it as blocked. `decideApproval` refuses a call that
    never asked: the wait marks its document `asked`, and a decision for a
    running call without that mark throws `ApprovalNotPendingError` instead
    of approving it. `GateHooks.replaySafe(args)` lets a tool declare a call
    replay-safe for some arguments (one that only waits on the owner), so a
    restart re-attaches instead of reporting "interrupted".
  - **Chat projection** (`ChatProjection`). The fold from pi-durable events to
    chat states, the window and the diff moved out of `watchChat` into a pure
    module tests drive with recorded events. Unanswered reasons are recovered
    from the conversation's submission records on every snapshot, so a
    reconnect and a one-shot `readChat` show them. `readChat` of an idle
    conversation reads the store directly without opening a watch.
  - **Policy** (`compilePolicy`, `applyPermissions`, `resolveModelId`,
    `PermissionsDoc`). A pure function from catalog, selection and installed
    extensions to the agent change and the permissions document. `familyOf`
    reads the `custom:` tag the runtime actually emits.

- [#21](https://github.com/AshikNesin/tiny-agents/pull/21) [`85971f0`](https://github.com/AshikNesin/tiny-agents/commit/85971f05a93f87dc801a9a71237729c9e49d3a61) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Grok-style bot-to-bot transcript UI: add `@tiny-agents/agent/peer-envelope`
  with `parsePeerEnvelope` / `stripPeerEnvelope`, a shared parser for the
  system attribution prefixes the delivery pipeline writes ("Reply from X:",
  "Message from X (bot):", "[From the owner, in Y's chat]"). The web client
  now renders cross-bot traffic as attributed cards — peer avatar + name
  header for relays and message_bot deliveries, a "You · in {host}'s chat"
  label for mentions, and an avatar handoff pill for the message_bot tool row
  — instead of raw prefixed bubbles, and bot-list previews show the payload
  rather than the prefix. The stored text and everything the model reads is
  unchanged.

- [#60](https://github.com/AshikNesin/tiny-agents/pull/60) [`371f766`](https://github.com/AshikNesin/tiny-agents/commit/371f766487b4800ad9c228326012f471822ebf94) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Push notifications via Pushover (issue [#57](https://github.com/AshikNesin/tiny-agents/issues/57)). `@groot/core/notification` replaces the `send-push-notification` wrapper with a small fetch client (`pushover.ts`) behind a channel port (`notifier.ts`) and a `NotificationService` whose `notify()` never blocks or throws: per-event switches, dedupe backed by the new `NotificationLog` table (so replays after a restart stay quiet), coalescing with cancel-on-resolve, quiet hours with a digest, throttling (30/h, 5/min per bot) with one "suppressed" summary, retries for transient failures only, and the 429/invalid-credentials channel states. Free text is scrubbed (`scrub.ts`: links, registered redactors, secret-looking runs, length caps). Settings live in the `notifications` app setting; `/api/v1/notifications` serves status, settings, a test send, re-validation and the log, and Settings gains a Notifications tab (`@groot/shell`). The agent's `WaitTracker` reports each waiting call (`onTransition`, with the tool and a preview) and `AgentRuntime.onWait` exposes it. App side: approvals, questions (plus one reminder), failed and long replies while the chat is closed, and routine results, misses and pauses push with deep links (`/chats/:botId?focus=approval:<task>` scrolls to the card); the startup ping becomes a silent `system.started`. Vault approvals name the item and target host, credential requests push to `/vault/requests/:task` and expire with the request, the vault's reveal/delete/refused-fill alerts become the locked `vault.alert` security event, and the vault's secret redactor scrubs every push (`WaitInfo` gains `subject` and `expiresAt`).

- [#61](https://github.com/AshikNesin/tiny-agents/pull/61) [`1592b0d`](https://github.com/AshikNesin/tiny-agents/commit/1592b0de69f7afdc8bb2937c4d97746d5dd6509d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots read uploaded files, not just images (issue [#58](https://github.com/AshikNesin/tiny-agents/issues/58)).
  
  - Every upload is sniffed: the stored MIME is the bytes' type, a mismatch or an executable is a 415, and code and plain-text extensions are allowed.
  - Files extract in a worker thread (memory cap, timeout) to `chat/<id>/extract.json`:
    - text and code, CSV/TSV, JSON/YAML (validity), HTML as text;
    - PDF pages, outline and metadata (unpdf);
    - DOCX/ODT as Markdown, XLSX/ODS sheets (cached formula values, hidden sheets), PPTX/ODP slides with notes;
    - zip/tar/tgz/gz listings with traversal, ratio and size caps, never extracted.
  - `Upload` gains `sha256`, `extractStatus`, `extractError`, `extractMeta` and `extractedAt`.
  - Sends carry a reference line per file with its id and state, plus the file's text when it is small, fenced as `<attachment … untrusted>`.
  - New `attachments` toolkit, given to every bot: `list_attachments`, `read_attachment`, `search_attachment` and `copy_attachment_to_sandbox` (binary SFTP writes: `SandboxSession.writeFile` takes bytes). Ids are scoped to the conversation.
  - New routes `GET /uploads/:id` and `GET /uploads/:id/text`; content responses send `nosniff`; deleting an upload removes its extraction.
  - File chips show the extraction state and open a text-only preview. The owner's bubble and memory capture leave file text out (`stripAttachmentNotes`).
  - The vision send path keeps file notes alongside the images.

- [#68](https://github.com/AshikNesin/tiny-agents/pull/68) [`3834e7b`](https://github.com/AshikNesin/tiny-agents/commit/3834e7b5566ea04dffa7f3e15f045306829a97c4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Routines run in conversations of their own and show results as cards in the bot's chat (issue [#63](https://github.com/AshikNesin/tiny-agents/issues/63)).
  
  - `Routine.conversationId` (nullable unique, both engines, migration `routine_conversation`): created on a routine's first fire from the bot's config and reconciled on every fire (`submitToBot` takes an optional routine target). A fire never adds input to the bot's chat or the owner's queued messages, and runs of one routine share their conversation so later runs see earlier ones.
  - A finished run shows as a card in the bot's chat, rendered from its `RoutineRun` row and merged into the timeline by finish time. The chat stream sends `routine-runs` on connect and `routine-run` as runs finish. Cards are not transcript entries, so the bot's context is unchanged. A failed submit no longer writes a "paused" notice into the chat; the run's card says so.
  - The watcher correlates replies inside the routine's conversation only, so the owner chatting during a run never becomes its output.
  - `CapabilitySelection.unattended` (agent): a conversation nobody watches refuses `ask` tool calls instead of waiting (`approval: "refused"` on the tool call, `FinishedReply.refused`), never auto-reviews, and `ask_owner` / `request_credentials` return at once. The watcher fails such a run with the tool named, e.g. "Needs approval for `send_email`; set it to Allow for this bot to use it in routines."
  - "Is this a routine turn?" is now `Routine.conversationId = ?` (`conversationOwner` / `isRoutineConversation` in `bots.owner.ts`), used by the recursion guard, the vault, memory, notifications, skills, browser, credential requests and bot-to-bot messaging. The `**Routine "` text checks are gone. The owner can manage routines while a run is working.
  - A routine run's `message_bot` gets no answer relayed back, since that would land in the bot's chat. Moving a routine to another bot starts a fresh conversation for it; deleting a routine or its bot stops its conversation.

- [`db1c8aa`](https://github.com/AshikNesin/tiny-agents/commit/db1c8aa284e424ba3c92068466a87f0439af7fa2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Routines (issue [#18](https://github.com/AshikNesin/tiny-agents/issues/18)): schedule any bot to run a prompt on a once/cron/interval schedule in IST.
  
  Engine (phase A): Routine/RoutineRun tables (both engines, unique (routineId, scheduledFor) as the exactly-once ledger), a pure schedule module (next occurrence via cron-parser in Asia/Kolkata, grace clamp, cronstrue sentences, IST wall-clock labels), a fast LLM-free `routine-fire` job that submits the labeled prompt into the bot's durable conversation with a stable requestId and chains the next delayed job, an activity-feed completion watcher that resolves awaiting runs with a reply preview plus a boot sweep for restarts, and a JWT-protected REST API under /api/v1/routines (CRUD, pause/resume, run now, run history).
  
  UI (phase B): a Routines page with upcoming runs, schedule cards (enable toggle, run now, edit, delete), and recent executions with status chips, durations, and manual/schedule trigger badges. The editor dialog picks a bot and compiles Once / Daily / Weekly / Interval / Custom cron presets into the schedule union (once carries an explicit +05:30 IST offset), showing the plain-English sentence and the next 3 fire times in IST before saving.
  
  Chat toolkit (phase C): a `routines` toolkit on the agent package, per-bot enable like tasks/web, so the owner can set up a routine in chat. `create_routine(name, prompt, schedule)` validates the union exactly like the API and answers with a confirmation card (the cronstrue sentence plus the next 3 fire times in IST); `list_routines` shows each routine's sentence, next run, and paused marker; `update_routine` and `delete_routine` are partial and replay-safe (durable memo delete report); `run_routine_now` fires a manual occurrence. `list_routines` defaults to allow, the mutating tools to ask. Routine.sourceKey (nullable unique, both engines, same pattern as Task.sourceKey) makes creates exactly-once across pi-durable replays, and the app-side store adapter rejects routine management from routine-fired turns (the recursion guard) while list stays open.
  
  Also fixes a latent bug in the pg-boss queue adapter: `delaySeconds` was silently dropped (pg-boss v12 has no such option), so every delayed Postgres job ran immediately; it now maps onto `startAfter`.

- [#20](https://github.com/AshikNesin/tiny-agents/pull/20) [`c1572ce`](https://github.com/AshikNesin/tiny-agents/commit/c1572cec3d397bf650cf5407fa8be8d2d689c828) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Sandbox toolkit (issue [#19](https://github.com/AshikNesin/tiny-agents/issues/19)): a keyless shell on the shared sandbox VM over
  Tailscale SSH. Three gated tools — run_command (exec with timeout and
  detached mode), read_file (binary-safe SFTP; non-UTF-8 described, not corrupted)
  and write_file (UTF-8 content, written to a temp name then renamed). One pooled ssh2 connection per process, no credentials
  (the tailnet ACL is the authentication), TOFU host-key pinning persisted in
  KV. Wired as a built-in capability behind SANDBOX_HOST / SANDBOX_PORT /
  SANDBOX_USER; read_file defaults to allow, run_command and write_file ask.

- [#132](https://github.com/AshikNesin/tiny-agents/pull/132) [`e7cd039`](https://github.com/AshikNesin/tiny-agents/commit/e7cd039d60bc9b9f26939931d691a2958ed308df) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Adds self-improvement: a `self-improve` capability whose `update_instructions` tool lets a bot propose edits to its own system prompt, taking effect from its next message. The tool is `askOnly` — the owner approves every change in chat, with the proposed text on the approval card — and the store adapter refuses writes outside the owner's own turns (routine runs, peer deliveries), the same rule as `remember`. The bot's current instructions render as a prompt section beside the tool. Every applied change (self or manual editor edit) appends a full-snapshot `prompt_revisions` row before the bot row updates, giving append-only, revertable history — the database analog of an instructions file under git.

- [#49](https://github.com/AshikNesin/tiny-agents/pull/49) [`786e799`](https://github.com/AshikNesin/tiny-agents/commit/786e799d53e2a6e58f053fb49d6c228e260eb27c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots share one browser profile by default. The browser toolkit now keys live
  browsers by profile (`BrowserTarget`: profile plus tab): bots on one profile
  share one Chrome, and so its logins, each driving a tab of its own, with the
  acting bot's tab brought to the front. A bot can be switched to its own
  profile in the bot dialog (new `browserProfile` column, `"shared"` or `"own"`).
  Taking control and Reset act on the whole shared browser; the panel warns
  before a reset signs every bot out. Existing per-conversation profiles are no
  longer used, so sites need one fresh sign-in on the shared profile.

- [`92c2060`](https://github.com/AshikNesin/tiny-agents/commit/92c2060bfbdfa1969764ae80372f899251e08a52) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add task tools: a pi-durable "tasks" extension (create/list/update/complete/delete_task) that lets bots manage the app's task list from chat, replay-safe with callId-keyed exactly-once creates. AgentRuntime.open gains an `extensions` option; testing.ts gains `respondWith` (faux tool-call replies) and re-exports `fauxToolCall`.
  
  Also: container-env tolerance for the gateway URL builders. Coolify and
  docker-compose editors keep literal quotes around values
  ('"https://…"', '"[{…}]"'); those now unquote instead of producing
  "Invalid URL" at send time, GATEWAY_BASE_URL validates as a URL (falls
  back to the real gateway host with a boot warning), a bad custom-provider
  prefix is skipped with a warning instead of crashing mid-chat, and
  GATEWAY_CUSTOM_PROVIDERS/GATEWAY_MODEL_ALLOWLIST tolerate quote wrapping.
  createGatewayModels(env) accepts an explicit env; AgentRuntime passes its
  snapshot.

- [`9f88d8f`](https://github.com/AshikNesin/tiny-agents/commit/9f88d8f5837bcffa1440bb57511d1e4c9b9f0690) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Terminal capability (issue [#28](https://github.com/AshikNesin/tiny-agents/issues/28)): a `/terminal` page with xterm.js tabs
  attached to tmux sessions on the sandbox VM, reached over the same keyless
  Tailscale SSH as the sandbox toolkit. Sessions live in tmux on the VM (own
  socket, `ta-terminal`), so tabs survive browser closes, network roams,
  redeploys and device switches. Server: stateless TerminalService + fresh
  ssh2 connection per attached tab (tailscaled stalls multiplexed channels),
  single-use ticket WS bridge (binary pty frames, resize control frames,
  1000 permanent / 4000 idle / 1011 attach-fail close semantics). Client:
  lazy xterm chunk with WebGL-to-DOM fallback, reconnect with fresh tickets,
  close-confirm on running processes.

- [`4c9ad9c`](https://github.com/AshikNesin/tiny-agents/commit/4c9ad9c7166a4b204c15843064f6513e1e985f38) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Terminal keys panel + full screen: `/terminal` gains a Termius-style
  collapsible keys column (esc/tab/arrows/home/end/pgup/pgdn, ^C ^D ^Z ^L ^R,
  sticky ctrl/alt, symbols | \ ~ -, clipboard paste) that writes pty bytes
  into the active tab. Below `md` the panel overlays the terminal as a
  translucent `w-28` column (phones start collapsed, remembered in
  localStorage); at `md+` it docks beside the terminal as a `w-44` column.
  Full-screen support (header toggle, `terminal-region` fixed inset-0 with
  CSS as the source of truth and the Fullscreen API best-effort, Escape
  keyboard lock where supported) and an `onControls` registry so the page can
  drive any mounted view without re-rendering on socket lifecycles.

- [#52](https://github.com/AshikNesin/tiny-agents/pull/52) [`1aba64a`](https://github.com/AshikNesin/tiny-agents/commit/1aba64adc300564792ce34e7a65d067d02ee9148) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Web search and page fetch go through TinyFish instead of Cloudflare. `web_search` calls `https://api.search.tinyfish.ai` and `web_fetch` calls `https://api.fetch.tinyfish.ai` (markdown, live fetch, `ttl: 0`). Both need `TINYFISH_API_KEY`; the calls themselves are on TinyFish's free tier. `CLOUDFLARE_API_BASE_URL` is no longer read.

- [`a6a4e79`](https://github.com/AshikNesin/tiny-agents/commit/a6a4e79fded85cb2fa1e7bbd2c3560555ea07ea7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A vault use names its target's kind. `VaultUse.targetKind` (`origin`, `host`,
  `command`, `connection`) says how the item's policy reads `target`, so the
  vault no longer branches on tool names and a new sink declares its kind
  instead of editing policy. Sinks share one sequence, `useFromSink` (grant,
  gate decision, moved-target refusal, broker use), instead of each repeating
  it. A sink that throws is audited `sink_error` (new `VaultOutcome`) and does
  not bump the item's last use; before, it was audited `used`. A connection's
  secret resolves through the same policy check as every other use. The vault
  raises owner alerts through `vault.alerts.ts` rather than importing the
  notification wiring. Credential requests record the bot on their audit rows,
  refuse a second submit while one is filling, and settle as filled even when
  saving the login to the vault fails afterwards.
  
  Alongside: `conversationOwner` returns the bot behind a conversation (id,
  name, model, browser profile, memory flag) and whether it is the bot's chat
  or a routine's, so no caller re-joins the bot row; `chatOwner` names the
  chat case. Push notifications for a failed or long reply and memory
  capture's debounce are steps of the settled pipeline (`bots.settled.ts`),
  which now records when each reply started; nothing else listens for idle.
  A Turn that settles while a memory capture is running re-arms the quiet
  window instead of being dropped.

- [#59](https://github.com/AshikNesin/tiny-agents/pull/59) [`9029da7`](https://github.com/AshikNesin/tiny-agents/commit/9029da718a59d989f03a27e9a581d81244cf6698) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add the vault (issue [#56](https://github.com/AshikNesin/tiny-agents/issues/56)): bots use the owner's logins, cards, one-time codes and API keys by handle, and the model never sees a value. The agent package gains the `VaultBroker` port and `SecretValue`, a process-wide `secretRedactor` that scrubs every gated tool result and the transcript view, gate plans for tools (`withGatePlan`: refuse, ask regardless of permission, add to the card, offer a "for this chat" grant kept in the new `tiny.grants` document, expire the approval), expiring owner waits, the `vault` toolkit (`vault_list`), `browser_fill_secret`, `browser_enter_code` and `request_credentials` in the browser toolkit (with an in-page origin check and a login/payment form classifier), `http_request` in the web toolkit, and `secrets: [{handle, env}]` on `run_command`: values over stdin into env vars for one command, every use approved, the command confined in a locked-down systemd unit to its items' hosts. `SANDBOX_EGRESS_ALLOWLIST` confines every sandbox command to an outbound allowlist. `AgentRuntime.decideApproval` takes `{ grant }`, and `credentialRequest` / `settleCredentialRequest` answer credential requests; new chat tool statuses are `awaiting_credentials` and `expired`. Core's logger and Sentry run every message through a scrubber the app can register (`setScrubber`). The schema adds `VaultItem`, `VaultAuditEvent` and `Connection.secretRef`. The app ships 1Password Connect and local backends, the Vault page with step-up, credential request sheets, and vault approval cards; see docs/features/vault.md.

### Patch Changes

- [`6eb3213`](https://github.com/AshikNesin/tiny-agents/commit/6eb3213531c944636c0810c0d900a8e7ba3aa0a5) Thanks [@claude](https://github.com/claude)! - `AgentRuntime.readChat(ref)` reads a conversation's chat state once (the snapshot `watchChat` delivers first) for one-shot readers such as the relay, the routines watcher and memory capture, replacing the watch-then-stop idiom at those call sites. The bot-to-bot relay now runs for the conversation that went idle instead of sweeping every bot with pending deliveries on each idle; the boot sweep is unchanged.

- [`31d338d`](https://github.com/AshikNesin/tiny-agents/commit/31d338d3c702dbf51129b07fd3267d85f17909a4) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Every bot submit path (sendMessage, mention delivery, bot-to-bot relay) now reconciles the durable conversation's configuration from the bot row before submitting, and a saved `vision` toolkit is dropped when the model sees images natively. Previously a conversation kept the config from its last explicit configure, so a model that gained vision (e.g. glm-5.3-flash) left the stale see_image prompt installed and the bot fabricated attachment ids.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`666cafd`](https://github.com/AshikNesin/tiny-agents/commit/666cafd7c4ddcd692fd31aa1ef5dd847b842f348) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Approval cards now say what the bot wants to do in plain words: "Chief wants to
  open a page", "wants to delete a task", "wants to run a routine now", instead of
  "wants to opened a page" built from the past-tense label the transcript shows
  afterwards. Every built-in tool carries an imperative `askLabel` next to its
  `label` in the capabilities API, and tools without one (connection tools) read
  "wants to use <tool name>". The Always allow button's tooltip uses the same
  wording.

- [`58ad432`](https://github.com/AshikNesin/tiny-agents/commit/58ad4328986aa69ed7281425ceae42ba254e3d46) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bot-to-bot relay fix: each delivered message is now answered by the
  assistant reply that actually follows it, not the target's latest reply.
  A restart sweep can no longer relay a stale pre-delivery reply, and two
  messages queued to the same bot each get their own answer relayed back
  (one reply could previously answer both, losing the second). Hand-typed
  mentions also match case-insensitively ("@ada" reaches "Ada") and the
  composer placeholder hints at "@ to tag a bot".

- [`e55fe6f`](https://github.com/AshikNesin/tiny-agents/commit/e55fe6f4fbe58704569e5ae5bfce36561e737275) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser toolkit: resolve a system chromium on deploy images. The executable
  chain now also picks up Debian's apt chromium (`/usr/bin/chromium`, installed
  via `railpack.json` `aptPackages`) after the VM's headless shell and before
  Playwright's bundled binary, so production deploys get a working browser with
  no env vars. The "no browser installed" error now names all three fixes.

- [`8af6c00`](https://github.com/AshikNesin/tiny-agents/commit/8af6c000505b5cc575993db964318ae25f439086) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser live view: serve frames over SSE instead of MJPEG. multipart/
  x-mixed-replace in an <img> does not survive reverse proxies — Cloudflare
  (in front of the production deploy) buffers or reshapes it and the panel
  stays black even though the browser session is healthy. The live route now
  emits `event: frame` SSE messages (base64 JPEG) — the same transport the
  chat feed already streams through — and BrowserPanel paints each frame
  into the viewport <img> as a blob URL. Verified end-to-end against the
  sandbox VM chromium: first frame ~56ms after connect.

- [`98b28d2`](https://github.com/AshikNesin/tiny-agents/commit/98b28d291238d236f4d693f72759bfcd34680637) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser panel: full screen now fills the screen, and the panel has a new look.
  The bot's connection to Chrome on the VM used to drop silently after about a
  minute of idle (the local CDP forwarder was an HTTP server, and its 60 s header
  timeout cut the WebSocket). Resizing then did nothing while the session still
  looked open, so a window expanded after a pause stayed at its old size in one
  corner of the canvas. The forwarder is now a plain TCP relay, a browser that
  dies is dropped (the panel shows Closed instead of a frozen view, and the
  bot's next browser tool call opens a fresh one), and `POST /browser/resize`
  answers 502 when it cannot resize instead of 200 with nothing done. The viewer
  sends one resize at a time, refits to the latest panel size afterwards, and
  retries a failed fit twice. Fitting the Chrome window now takes one round trip
  to the VM instead of four, so the window keeps up with the screen when you
  enter or leave full screen, and a panel narrower than Chrome's 500 px minimum
  window (the 360 px panel, a phone) shows the whole window scaled down instead
  of cropped. The panel is now a card with a title, a live status line (Live,
  Connecting, Reconnecting, Headless, Closed) with who is driving and the URL,
  labelled Paste and Full screen buttons, Take control and Release control in
  the header, a header that collapses to icons when narrow, and empty, starting
  and failed states that match the rest of the app.

- [#26](https://github.com/AshikNesin/tiny-agents/pull/26) [`d241660`](https://github.com/AshikNesin/tiny-agents/commit/d241660baa5767d9df7a88c8cbe5b80aa0613061) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser toolkit: with SANDBOX_HOST set, bot browsers run on the sandbox VM —
  each session launches a per-profile headless-shell there (CDP on 127.0.0.1,
  tunneled through the same keyless Tailscale SSH channel as the sandbox
  toolkit) and playwright-core connects over CDP. Closing a session kills the
  remote chromium. Deploys without SANDBOX_HOST still fall back to the local
  chain (apt chromium / bundled Chromium).

- [#53](https://github.com/AshikNesin/tiny-agents/pull/53) [`493336a`](https://github.com/AshikNesin/tiny-agents/commit/493336a4d360cfdb3da04c09cbdb43bef62f9523) Thanks [@AshikNesin](https://github.com/AshikNesin)! - `browser_snapshot` reads Playwright's accessibility snapshot, and click and type act on those refs. `browser_type` replaces a field in one step. A text field is clicked first so the text lands in the page on the VM's Chrome; date, color, range and select fields are filled directly. It used to send one key event per character, which timed out on the VM link and could land in the address bar.

- [#115](https://github.com/AshikNesin/tiny-agents/pull/115) [`a8a008d`](https://github.com/AshikNesin/tiny-agents/commit/a8a008d51e84d0df42eb513cb7b492669e37fca2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - browser_type on a dropdown now chooses the option whose label or value is
  the text. It called Playwright's `fill`, which throws on a <select>, so bots
  could not pick an option; the unit test's stub accepted `fill` on a select
  and hid it.

- [`b0e6a13`](https://github.com/AshikNesin/tiny-agents/commit/b0e6a13731c221245673146d37a547c71fb191ed) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser on a VM: starting a second bot's browser no longer hangs while another
  bot's browser is open. The launch lock was inherited by Xtigervnc, vncconfig
  and Chrome, so it stayed held for as long as the first browser ran and every
  other launch waited on it until it timed out with "VM exec timed out: start the
  browser". The browser processes now release the lock, a launch waits for it at
  most 25 s with a clear error, the launch script always ends by itself before
  the app gives up on it (so timed-out scripts no longer pile up on the VM and
  start browsers nobody can reach), and a launch that fails midway tears down
  what it started. The lock file is now `~/.tiny-agents/browser-launch.lock`.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`a3c31c7`](https://github.com/AshikNesin/tiny-agents/commit/a3c31c790262a4747d64e9b3bdbfd4d7e15eb4b1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Long chats open fast and stay fast. Opening a chat, reconnecting, or catching
  up after a slow connection used to send and render the whole conversation,
  which grows forever (one conversation per bot). The live stream now starts
  with the newest 60 messages; scrolling up loads earlier messages 50 at a time
  (`GET /api/v1/bots/:id/messages?before=…`) without moving what is on screen,
  and a reconnect keeps the history already loaded.

- [#55](https://github.com/AshikNesin/tiny-agents/pull/55) [`601772a`](https://github.com/AshikNesin/tiny-agents/commit/601772a74aff3dc4542b763f9faf43e62835479f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Turn individual MCP connection tools on or off for every bot, and open any tool on its own page. Each row in a connection's tool list now has a switch and links to `/connections/:id/tools/:tool`, which shows the tool's description, behavior hints (read-only, idempotent, destructive, open world), input and output schema (as fields or raw JSON Schema), an "Available to bots" switch, and a playground that calls the tool on the live server from a generated form or a JSON editor. Tools that may change data ask before running. Turned-off tools are kept in the new `Connection.disabledTools` column, are never installed into the runtime (so no bot sees them, whatever its own permissions say), and stay off across reconnects; tools a server adds later start on. New endpoints: `GET`/`PATCH /connections/:id/tools/:tool` and `POST /connections/:id/tools/:tool/call`. The agent package's cached MCP tool info now carries `outputSchema` and the destructive/open-world hints, and call results carry `structuredContent`.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`2cb97ff`](https://github.com/AshikNesin/tiny-agents/commit/2cb97fffd97ace0cd763e6c3984289dc0d2420aa) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Deleting a bot now closes its browser tab. In the shared browser its tab
  closes (or, if it was the browser's first tab, goes blank and is freed) and the
  other bots' tabs stay as they are; a browser that no bot uses any more closes.
  A bot with a browser of its own has that browser closed and its profile
  (cookies and logins) wiped. Before, the tab stayed open next to other bots'
  tabs until the whole shared browser went idle.

- [#51](https://github.com/AshikNesin/tiny-agents/pull/51) [`f1e3914`](https://github.com/AshikNesin/tiny-agents/commit/f1e39146a6cd72b104b41a905080fea52a9a340c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bump dependencies, including `@earendil-works/pi-durable`, `pi-ai`, and `chord` to 1.4.0. Document definitions pass `checkpointWhen: () => false` so ordinary changes stay deltas. Sentry 11, files-sdk 3, and SimpleWebAuthn 14 needed small call-site updates.

- [`2ab32b4`](https://github.com/AshikNesin/tiny-agents/commit/2ab32b4820df9871a27f9312b8f29c3bad5f8e3d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Durability follow-ups: `delete_task` remembers (via durable tool memos) that an attempt started and how it ended, so a rerun after a crash reports the delete instead of "No task with id"; chat snapshots load the whole transcript in 500-entry pages instead of only the newest 1000 entries; a failed `AgentRuntime.open` now closes the Harness/storage it opened before releasing the store lock.

- [`2ab32b4`](https://github.com/AshikNesin/tiny-agents/commit/2ab32b4820df9871a27f9312b8f29c3bad5f8e3d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Key `create_task`'s exactly-once create on the durable tool task (salted with the conversation's persisted `pi.provider` UUID) instead of the provider's tool call id. Call ids come from the upstream model and are only unique within one assistant message: OpenAI-compatible providers may reuse short ids or send none, which made a later create silently return an earlier task (or skip dedup entirely for empty ids). Adds restart tests that close the runtime mid-reply and mid-tool-call and verify the work resumes exactly once.

- [`9e6b629`](https://github.com/AshikNesin/tiny-agents/commit/9e6b629b9146186b3d3b08cc65f3a78c32943389) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Allow AgentRuntime.open to take an env snapshot (options.env). The faux/E2E boot uses it to clear GATEWAY_MODEL_ALLOWLIST, which otherwise filters the faux test model out of /models and breaks e2e bot creation on machines whose .env sets the allowlist.

- [`8dd01ad`](https://github.com/AshikNesin/tiny-agents/commit/8dd01ad7f48d3326a124eb838f0b9061797f31c7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix memory capture discarding short preferences: use a 24-byte owner-text threshold, the bot's own model instead of a hardcoded gateway model, assistant context, and today's date. Preserve the watermark and log returned model errors. Exclude peer/routine exchanges from capture.
  
  Add an approval-gated `remember` tool for immediate chat-side saves. Saves share background capture's transaction, dedupe (including deleted memories), and budget without advancing its watermark. Existing read-only memory adapters remain compatible.

- [#104](https://github.com/AshikNesin/tiny-agents/pull/104) [`0826ecb`](https://github.com/AshikNesin/tiny-agents/commit/0826ecbc3ea7c3e68fa93bb00648688d53cb0b81) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Move to groot 3.0: Hono instead of Express, Drizzle on SQLite instead of
  Prisma, a table-backed job queue instead of honker, code config instead of
  config.yml and varlock. tiny-agents stays on Node (Chromium, ssh2 and the
  pi-durable store run in-process).
  
  - **Your data moves over on the first boot.** A database from the Prisma
    build is renamed to `app.db.prisma-backup-<time>` and every row is copied
    into the new layout: users, passkeys, bots, past chats, skills, connections,
    messages, tasks, vault items and audit events, uploads, routines and runs,
    memories, the notification log, and key-value settings (local vault
    secrets, SSH host keys, app and notification settings). Routines re-arm
    their next run on boot.
  - **Existing passwords keep working.** A bcrypt hash from the old build is
    accepted once and replaced with a PBKDF2 hash on that sign-in. Vault
    step-up accepts both.
  - **Uploads persist across redeploys.** They now live beside the database
    (`/app/data/uploads` with the current volume) instead of `./local/uploads`
    in the container; files still in the old folder are copied over.
  - The groot 3.0 UI refresh comes along: one control height scale, rounder
    surfaces, toasts that follow dark mode, CodeMirror on the theme tokens, and
    the warm palette now lives in the shell (app.css keeps only chat tokens).
  - Fixes found on the way: a bot edit that only changed its skills or
    connections returned 500 under Drizzle; the login page showed the raw error
    instead of "Invalid email or password" with the fetch client; a server
    error message without a code (the terminal's, for one) was replaced by the
    generic fallback. `ApiError` now carries `fromServer` to tell the two apart.

- [#23](https://github.com/AshikNesin/tiny-agents/pull/23) [`d3edec4`](https://github.com/AshikNesin/tiny-agents/commit/d3edec495049d15abdd18b5c7832224ef4a25e93) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Adds durable per-bot memory (issue [#22](https://github.com/AshikNesin/tiny-agents/issues/22) phase A): a `memories` table with a typed lifecycle (active/superseded/archived/expired/deleted), a `memory` capability section that injects what a bot remembers about the owner into its prompt on every send, `Bot.memoryEnabled` with capture/injection gating, and REST CRUD under `/api/v1/bots/:id/memories` with tombstone deletes that block exact-text re-capture. Overflow archives the oldest active rows at a 100-row budget, never truncating new facts.
  
  Capture (phase B): idle chats arm a per-conversation debounce (2 minutes quiet or 6 owner turns); one gateway side-call reads the owner turns since the watermark through an anti-junk extraction contract, and code alone decides what lands — exact-text dedupe against tombstones, same-bot supersession, budget archive, watermark bump in one transaction. Trivial windows and peer/routine turns never trigger a call; faux mode and missing gateway config disable capture without affecting manual memories or injection.

- [`c9fa54e`](https://github.com/AshikNesin/tiny-agents/commit/c9fa54e1d052a234608dcded83decb5fe65bbf5e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add message steering: sending while a bot is replying no longer blocks. Enter (or the send button, which stays live beside Stop) submits the message as a steer that joins the running reply after its current tool round; Alt+Enter queues a follow-up answered by the next run. Held messages render inline as tagged bubbles ("Steering into the reply" / "Queued for the next reply") with a cancel (x) that withdraws them, survive a reload from the server's durable queue, and flow into the transcript once placed. Cross-bot deliveries keep the queued-follow-up behavior.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`fea622e`](https://github.com/AshikNesin/tiny-agents/commit/fea622eaa18d350a1c0c5e3cfccda3960810d1fa) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Routines that can't do their job now say so instead of "succeeded". A run
  whose tool call was refused (nobody is there to approve it or type a sign-in),
  or that reports itself blocked (new `report_routine_blocked` tool, offered only
  in routine runs; routine conversations are told when to use it), is recorded
  as "needs attention" with the reason, on the Routines page and in the chat's
  run card. After three blocked runs in a row the routine pauses itself, the card
  says "Paused after 3 blocked runs: <reason>", and one notification goes out for
  the whole streak (blocked runs before that stay quiet). Resuming starts the
  count over, and any run that finishes normally resets it. Adds
  `Routine.blockedStreak` and `Routine.pausedReason` (migration
  `20261030160000_routine_blocked_runs`).

- [`ddedf15`](https://github.com/AshikNesin/tiny-agents/commit/ddedf1508f5cf1557b45ce75eebeaf274365f817) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The sandbox toolkit is configured out of the box: the app now defaults
  SANDBOX_HOST to the verified MagicDNS name (tiny-agents-vm) when the env
  variable is unset, so the capability is live after deploy without any env
  change. Setting SANDBOX_HOST still overrides — e.g. the Tailscale IP if
  MagicDNS breaks.

- [#46](https://github.com/AshikNesin/tiny-agents/pull/46) [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Describe an unreachable sandbox once: the terminal status no longer reads
  "Cannot reach the sandbox (Cannot reach the sandbox (…)). Is it online…? Is
  it online…?".

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`76a561b`](https://github.com/AshikNesin/tiny-agents/commit/76a561b24e6d65b27f43b37d33652122074cad04) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Terminal: opening the Terminal page no longer waits about 10 seconds for a
  prompt. Every terminal request used to open a fresh SSH connection to the
  sandbox (about 2 seconds each over the tailnet, three of them before the first
  prompt); listing, tickets and attaches now share one pooled connection that
  reconnects on its own and closes after five idle minutes, and getting a ticket
  no longer makes an extra round trip. A channel that stalls retires the shared
  connection so new work goes to a fresh one. The empty pane says "Connecting to
  sandbox…" until the first output arrives.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`f4c0411`](https://github.com/AshikNesin/tiny-agents/commit/f4c0411840151a1782caa0fd15429e31d90de939) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A tool's run time no longer includes the time it waited for your approval.
  Opening a page you approved after a minute and a half used to read "117.2s";
  it now reads the tool's own time with the wait beside it, e.g.
  "15.1s · waited 1m 40s for you".

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`037e1aa`](https://github.com/AshikNesin/tiny-agents/commit/037e1aaa6a33c555ee83be692bcd93103c012384) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Chat: a message you queued (Alt+Enter) and one you steered in while the bot
  was replying no longer shows "No reply was produced for this message" when a
  single reply answers both. Back-to-back messages that share one reply now count
  as answered; a message the runtime recorded as unanswered (for example stopped
  before a reply started) is still flagged.

- [`1d6353a`](https://github.com/AshikNesin/tiny-agents/commit/1d6353a8b48b209d9d540750cee36b961029830a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Custom gateway models declare their input modality: `vision: true` opts a model into image input, `vision: false` opts out, and `glm-5.3-flash` defaults to image-capable. pi-ai strips image blocks for models registered text-only ("image omitted: model does not support images"), which broke the see_image side-call in production; the transcriber now also declares image input on its resolved model defensively. Fixes the "I can't view images" replies on non-vision bots.
- Updated dependencies [[`4814aca`](https://github.com/AshikNesin/tiny-agents/commit/4814aca75211052126f2dfdd163f16ebbb6d50f0)]:
  - @tiny-agents/claude-worker@0.2.0
