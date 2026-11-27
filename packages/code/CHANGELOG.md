# @tiny-agents/code

## 0.3.0

### Minor Changes

- [#565](https://github.com/AshikNesin/tiny-agents/pull/565) [`566e80d`](https://github.com/AshikNesin/tiny-agents/commit/566e80df2f2d2ba9ad59d812d5f56170aafd6347) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Claude Code threads can now use your connections too. Every connection shared with every bot is offered to Claude Code, loaded on demand, and the calls run in the app, so connection sign-ins never reach the sandbox. Settings > Tools decides which tools run, ask or stay off, and a tool that asks shows the usual approval card.

- [#566](https://github.com/AshikNesin/tiny-agents/pull/566) [`dadbaf1`](https://github.com/AshikNesin/tiny-agents/commit/dadbaf1810244339d908e356695882f03b0497f8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code threads can now use your skills. Every skill shared with every bot is offered in Native and Claude Code threads. Only each skill's name and description go into the prompt, and its instructions load when a thread uses it.

- [#509](https://github.com/AshikNesin/tiny-agents/pull/509) [`7c34436`](https://github.com/AshikNesin/tiny-agents/commit/7c3443651e369eb579b5aa32c30ff7d90a7e4b45) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code has a third agent, Native, built on the same runtime the chat bots use. It needs a sandbox and a model that runs on pi, and no other setup. A Native thread reads, writes and edits files and runs commands in its working directory on the sandbox, asks before it changes anything unless its permission mode says otherwise, takes a steer or a queued message while it works, and can be stopped, forked, compacted and continued after an error. Settings → Models has a new default, New Code threads, for the model a Native thread starts on.
  
  For developers: `AgentRuntime` gains `cwd` on a conversation's config, `fork`, `compact` and `continueReply`; `@tiny-agents/agent` exports `createCodingToolkit` and `codingSelection`; `@tiny-agents/code/server` exports `createPiHarness` and its `PiPort`; the model catalog has a `code_default` role; and a sandbox `exec` takes an abort `signal`.

- [#586](https://github.com/AshikNesin/tiny-agents/pull/586) [`fbd8ec0`](https://github.com/AshikNesin/tiny-agents/commit/fbd8ec069d5a25b65b3b306cebcb77f9aba60d8d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Typing `/` at the start of a message lists your skills: in a bot chat (the bot's skills) and in a Code thread whose agent takes skills (Native and Shelley). In a chat the pick is written as `/skill-name ...`, and the bot is told that such a message asks for that skill. In a Code thread the pick joins the message's skills like the **+** menu. Native threads now list skills too, the shared ones plus the repo's `.agents/skills` and `.claude/skills`, and a Native agent reads a repo skill's `SKILL.md` when asked for it by name.

### Patch Changes

- [`54143fb`](https://github.com/AshikNesin/tiny-agents/commit/54143fbd55708fab2684c0f8041189b3e29307df) Thanks [@ampagent](https://github.com/ampagent)! - Four audit fixes in the self-update channel, the legacy database migration, Shelley transcripts and the Claude turn queue.
  
  The self-update channel now notices when the `pnpm local` supervisor goes away: the supervisor status is cleared, and check/apply answer the same 409 as an unsupervised server instead of a silent no-op 202 while the owner's update button appears to work.
  
  The one-time Prisma-to-Drizzle migration is crash-safe. A crash between the renames used to leave no `app.db` at all, so the next boot silently created an empty database. The new database is now flushed to disk before the swap, and the next boot detects a half-done swap and either completes it or restores the pre-migration database before anything opens it.
  
  A Shelley screenshot URL with a malformed percent escape (a file named `shot%zz.png`) no longer fails the whole transcript build for that conversation; the image degrades to its raw path. Image asset refs whose ids grow past four digits keep loading, matching what the producer mints in long conversations.
  
  A turn whose Claude process failed to start is failed with that error instead of staying in the session's queue and being replayed to the next process, which could re-run the turn's actions a second time.
- Updated dependencies [[`54143fb`](https://github.com/AshikNesin/tiny-agents/commit/54143fbd55708fab2684c0f8041189b3e29307df), [`566e80d`](https://github.com/AshikNesin/tiny-agents/commit/566e80df2f2d2ba9ad59d812d5f56170aafd6347), [`dadbaf1`](https://github.com/AshikNesin/tiny-agents/commit/dadbaf1810244339d908e356695882f03b0497f8), [`e511da5`](https://github.com/AshikNesin/tiny-agents/commit/e511da53df9f14db7849c0cdf861c34e2689baac)]:
  - @tiny-agents/claude-worker@0.5.0

## 0.2.5

### Patch Changes

- [#375](https://github.com/AshikNesin/tiny-agents/pull/375) [`b266c64`](https://github.com/AshikNesin/tiny-agents/commit/b266c649b0b4aa2beda65de72c57db9dc8134099) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code: a thread with an open pull request has a GitHub link beside the PR chip in its header, so the PR opens on GitHub in one click; the chip still opens the Review panel. A thread's list row now carries its PR's `url`.

- [#317](https://github.com/AshikNesin/tiny-agents/pull/317) [`371f074`](https://github.com/AshikNesin/tiny-agents/commit/371f074ef88bdc69d67e8ba9de5472643b6583ac) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code's Changes and Review panels are steady while an agent works, for every harness, on the local sandbox container or over SSH. The git reading lives in a new dependency-free `@tiny-agents/git` package shared by the app and the Claude worker.
  
  - **Right files, right counts.** A new file the agent has not committed shows up, a renamed file counts its lines on both sides, and a path with spaces or non-ASCII characters no longer breaks the whole Review panel.
  - **No lock fights.** Reading changes never rewrites the git index, so an agent's commit no longer fails with `index.lock` while a panel is open.
  - **Honest diffs.** A binary or oversized file (over 2 MB), from any harness, says so instead of showing garbage or a whole-file deletion; a very long diff draws its first 4,000 lines, and one too costly to work out says so instead of freezing the tab.
  - **No blinking.** A re-read keeps the file list, what you folded and your scroll on screen; the open Review diff follows the file when the agent changes it again.
  - **Live refresh.** While Changes is open, the server watches the directory's change stamp (one cheap git call every 1.5 s, slower once quiet) and the panel re-reads only when the files moved, on a steady beat even while the agent never pauses. A harness without a stamp (Shelley) is watched through its own uncommitted file list, so every harness that serves diffs is live.
  - **Edit diffs survive a reload.** Claude Code threads redraw each Edit with its real hunks and line numbers after a reload or reconnect, read back from Claude Code's own session file.

- [#460](https://github.com/AshikNesin/tiny-agents/pull/460) [`190dede`](https://github.com/AshikNesin/tiny-agents/commit/190dedebb005421039ab584d3dc44e630ae44990) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Remove code comments (ADR 0028)
- Updated dependencies [[`371f074`](https://github.com/AshikNesin/tiny-agents/commit/371f074ef88bdc69d67e8ba9de5472643b6583ac)]:
  - @tiny-agents/claude-worker@0.4.4

## 0.2.4

### Patch Changes

- [#277](https://github.com/AshikNesin/tiny-agents/pull/277) [`3342118`](https://github.com/AshikNesin/tiny-agents/commit/3342118da1af6ce513455ff5adafc858367a49da) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Claude Code on the Code page: a bad request is answered as one (register row C13).
  
  - **400:** a missing or unusable working directory, an unknown effort or permission mode, an empty title and the like answer 400 with the reason ("Unknown effort "extreme". Use one of: low, medium, high, xhigh, max.") instead of 500 "unexpected error".
  - **404:** a Claude Code thread that does not exist answers 404 ("No Claude Code thread …"), so a bot's `code_send` or `code_status` on it says there is no such thread.
  - **Unchanged:** anything the harness did not expect, such as the sandbox worker being unreachable, is still a 500.
- Updated dependencies [[`393dd71`](https://github.com/AshikNesin/tiny-agents/commit/393dd71934f643d83303f57467f54e90318a9b76), [`b5dcf5d`](https://github.com/AshikNesin/tiny-agents/commit/b5dcf5df004bd1294a853ee120c5e0032dc55f78)]:
  - @tiny-agents/claude-worker@0.4.3

## 0.2.3

### Patch Changes

- [#232](https://github.com/AshikNesin/tiny-agents/pull/232) [`1ac44ab`](https://github.com/AshikNesin/tiny-agents/commit/1ac44ab686f414d20cc268d80fc58652a25fb87e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - No hardcoded Claude models: the Claude plan and the Code page use only what Claude Code lists for your subscription.
  
  - **Settings:** a new Claude plan account connects with no models until Claude Code is signed in. "Check again" adds each model Claude Code lists, so a new model appears without adding it by hand. The `opus` / `sonnet` / `haiku` fallback is gone.
  - **Code page:** the Claude Code picker offers the Claude plan account's models (full ids, versioned names) instead of a fixed Opus / Sonnet / Haiku list. With none saved, it shows what Claude Code's sessions report.
- Updated dependencies [[`42a17f2`](https://github.com/AshikNesin/tiny-agents/commit/42a17f2a58bb901bb30d43998a922fe9ae64ccd4)]:
  - @tiny-agents/claude-worker@0.4.2

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
