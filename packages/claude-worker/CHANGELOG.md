# @tiny-agents/claude-worker

## 0.4.1

### Patch Changes

- [#218](https://github.com/AshikNesin/tiny-agents/pull/218) [`56ada98`](https://github.com/AshikNesin/tiny-agents/commit/56ada985d0014bbaeea7c04ff1dd09e9a78d8d2f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Settings has no separate **Claude plan** tab any more. The Claude plan's engine status and **Sign in to Claude** now sit inside the Claude plan account's card in Settings → Models, beside its models and fallback. Old `?tab=claude` links open the Models tab.

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

## 0.3.0

### Minor Changes

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

- [#177](https://github.com/AshikNesin/tiny-agents/pull/177) [`721a473`](https://github.com/AshikNesin/tiny-agents/commit/721a473961c44b6a08d4360a192bede1d169d0c6) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One session log under both Claude worker protocols. Bot sessions and coding
  sessions now keep their events in the same `SessionLog` (append, replay from
  a cursor, the resume answer, and a set of subscribers in place of the single
  `fanout` slot), exported with `Sequenced` from the package root;
  `resumeResultOf` moves there from the envelope and takes a log. The server
  owns the sockets, heartbeat and framing once, and each protocol is a handler
  that subscribes its sockets to its sessions' logs. `Session` and
  `CodingSession` lose `replay`/`firstSeq`/`lastSeq`/`fanout` (use `log`),
  `CodingSession.partial` becomes `CodingBook.onPartial`, and
  `SessionBook.replay` is gone. `codingSdkOf()` builds the coding SDK from the
  loaded Agent SDK module without a cast. The wire protocol is unchanged.

## 0.2.0

### Minor Changes

- [#117](https://github.com/AshikNesin/tiny-agents/pull/117) [`4814aca`](https://github.com/AshikNesin/tiny-agents/commit/4814aca75211052126f2dfdd163f16ebbb6d50f0) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Experimental Claude Pro/Max inference. Bots can select `claude-code/<model>`
  ("uses your Claude plan"). Turns go to a loopback worker that drives the
  official Claude Agent SDK. tiny-agents does not read, store, or refresh the
  Claude login, does not set `ANTHROPIC_BASE_URL`, and refuses to boot when
  model-provider config contains an `sk-ant-oat` token. `CLAUDE_CODE_ENGINE_ENABLED`
  is the kill switch. Default fallback is pause.
