# @tiny-agents/code

## 0.2.2

### Patch Changes

- Updated dependencies [[`56ada98`](https://github.com/AshikNesin/tiny-agents/commit/56ada985d0014bbaeea7c04ff1dd09e9a78d8d2f)]:
  - @tiny-agents/claude-worker@0.4.1

## 0.2.1

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

- [#208](https://github.com/AshikNesin/tiny-agents/pull/208) [`bc8cc60`](https://github.com/AshikNesin/tiny-agents/commit/bc8cc60182a4f056a526a53dca925d5384c636af) Thanks [@AshikNesin](https://github.com/AshikNesin)! - `turnOutcomeProblems` (`@tiny-agents/code/testing`) checks every
  `TurnOutcome` field from one table keyed by the type, so a new field does not
  compile until it has a check. It also reports an outcome that carries fields
  the rule does not answer, such as a thread summary spread into it.
- Updated dependencies [[`ae0099b`](https://github.com/AshikNesin/tiny-agents/commit/ae0099bfe7b438b19fd865ea839c73948afa41f9), [`83ae1fd`](https://github.com/AshikNesin/tiny-agents/commit/83ae1fd3a967a9625171681c9d4059b3b3f65b47)]:
  - @tiny-agents/claude-worker@0.4.0

## 0.2.0

### Minor Changes

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

- [#163](https://github.com/AshikNesin/tiny-agents/pull/163) [`a47cc42`](https://github.com/AshikNesin/tiny-agents/commit/a47cc42036b90e6b9f0b1f3dd0f3d517c32b434e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Harness drivers share one `ThreadFeed` (`@tiny-agents/code/server`) for the
  watch-thread protocol: a watcher's snapshot comes first, then only the rows
  that changed for it, the streaming text is re-sent after a snapshot while a
  turn runs, and a failing listener never stops the others. Drivers hand it
  full row lists and state; `ItemTracker` is gone (the feed diffs). The test kit
  adds `threadEventProblems(events)`, which checks any driver's watch output
  against the same rules.
  
  Shelley now starts its watchers over from a fresh snapshot after its stream
  reconnects (it used to send only the changed rows), so rows that disappeared
  while it was down go too, and a turn that ended meanwhile leaves no stale
  streaming text. The normalizers share `pick`, `isImageFile` (png, jpeg, gif,
  webp, avif and svg show inline for both harnesses) and the harness-neutral
  `lastAnswer(items)`.

- [#177](https://github.com/AshikNesin/tiny-agents/pull/177) [`10a1504`](https://github.com/AshikNesin/tiny-agents/commit/10a150410f40c44df1060c4cb89d054e01218c79) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One turn-outcome rule for every harness. `turnOutcome` and `turnAnswer`
  (`@tiny-agents/code/server`) build what a thread's newest turn came to from
  the rows the driver shows; Shelley and Claude Code use it for both
  `outcome()` and `turn_ended`, which now carries that `outcome` instead of
  `finalText`/`failed`. `lastAnswer` (shared and Shelley's own) is gone.
  
  - The text is the newest turn's answer or error, always a chat-sized
    excerpt, and `failed` means that answer is an error, for both harnesses
    (Shelley's turn ends used to carry no failure and its full final response).
  - A message after the newest turn end opens a new turn: with nothing
    answered yet the text is empty for both harnesses (Shelley used to report
    the previous turn's answer). A steer's turn keeps its answer from before
    the steer.
  - `endedAt` is when the harness last wrote to the turn, on its own record,
    and is absent while the thread works.
  - Claude Code reports a turn end once the worker is idle, so a steer the CLI
    ran as its own SDK turn no longer ends the hand-off early.
  
  The test kit adds `turnOutcomeProblems(snapshot, outcome, ended)`.
  `parseThreadId(id, legacyInstanceId)` resolves bare (pre-ADR 0011) ids, with
  `LEGACY_INSTANCE_ID`; the app splits thread ids only with it, so hand-offs and
  labels of bare Shelley ids resolve. The Code watcher takes the outcome from
  the event and no longer re-reads the thread or re-cuts the text.

### Patch Changes

- Updated dependencies [[`e14a12f`](https://github.com/AshikNesin/tiny-agents/commit/e14a12f917572c757f115e31402748e080bad20c), [`ff9c364`](https://github.com/AshikNesin/tiny-agents/commit/ff9c3643377ed3a0bc379f0b8690a6cd846f9ab7), [`1fc7691`](https://github.com/AshikNesin/tiny-agents/commit/1fc769128276b1c25b1e78f751d33de68fa10904), [`721a473`](https://github.com/AshikNesin/tiny-agents/commit/721a473961c44b6a08d4360a192bede1d169d0c6)]:
  - @tiny-agents/claude-worker@0.3.0
