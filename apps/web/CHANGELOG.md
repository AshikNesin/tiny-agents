# @groot/web

## 0.5.2

### Patch Changes

- Updated dependencies [[`42a17f2`](https://github.com/AshikNesin/tiny-agents/commit/42a17f2a58bb901bb30d43998a922fe9ae64ccd4), [`1ac44ab`](https://github.com/AshikNesin/tiny-agents/commit/1ac44ab686f414d20cc268d80fc58652a25fb87e)]:
  - @tiny-agents/agent@1.0.1
  - @tiny-agents/code@0.2.3

## 0.5.1

### Patch Changes

- Updated dependencies [[`56ada98`](https://github.com/AshikNesin/tiny-agents/commit/56ada985d0014bbaeea7c04ff1dd09e9a78d8d2f), [`9f7db2a`](https://github.com/AshikNesin/tiny-agents/commit/9f7db2a01b2008d521aa9bfa2e77ab4270cea9a7), [`e7ef2e4`](https://github.com/AshikNesin/tiny-agents/commit/e7ef2e4abfd913cc54e6cdf312113c8e58b5611e), [`3ca0b6b`](https://github.com/AshikNesin/tiny-agents/commit/3ca0b6b20b0bc18e034b00e3a25b6a2d7631f168), [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3), [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3), [`8d784a2`](https://github.com/AshikNesin/tiny-agents/commit/8d784a23e3e508fdaab434ea631d2adeda2acab3)]:
  - @tiny-agents/agent@1.0.0
  - @groot/shell@2.2.0
  - @tiny-agents/code@0.2.2
  - @groot/jobs@2.0.2

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

- [#180](https://github.com/AshikNesin/tiny-agents/pull/180) [`1c4f612`](https://github.com/AshikNesin/tiny-agents/commit/1c4f612e91ce5e9aebc0eee5c2d28157b9d01800) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code page: select several threads and archive (or restore) them at once
  (issue [#148](https://github.com/AshikNesin/tiny-agents/issues/148)). The new Select button turns the list into checkboxes, with
  Select all and one Undo for the whole batch; a picked thread's subagents go
  along with it.

### Patch Changes

- Updated dependencies [[`1c4f612`](https://github.com/AshikNesin/tiny-agents/commit/1c4f612e91ce5e9aebc0eee5c2d28157b9d01800), [`dfca2ee`](https://github.com/AshikNesin/tiny-agents/commit/dfca2ee485c4928fa911174e2a9ee613a2c4ca3f)]:
  - @tiny-agents/agent@0.5.0
  - @groot/ui@0.12.0
  - @groot/shell@1.5.0
  - @groot/core@2.0.1
  - @groot/jobs@1.1.3

## 0.4.1

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

- [#189](https://github.com/AshikNesin/tiny-agents/pull/189) [`6ed0fa4`](https://github.com/AshikNesin/tiny-agents/commit/6ed0fa4337bd0852bdb7580ffe740f4a898eaf48) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Render every breadcrumb through one component, so a list item can't land
  inside another one again (40a8092, e017985).
  
  - `@groot/ui`: new `Breadcrumbs` in `@groot/ui/breadcrumb`. Its children are
    the ancestor crumbs, each a link or button element, and `page` is the
    current page: `<Breadcrumbs page={job.name}><Link to="/jobs">Jobs</Link></Breadcrumbs>`.
    It places the list items and separators. Fragment children are flattened,
    and a `false` page counts as no page. Every existing breadcrumb export
    stays.
  - Lint rule R5a now fails an import of `BreadcrumbItem` or
    `BreadcrumbSeparator` from `@groot/ui`, `@groot/ui/breadcrumb` or the ui
    source outside `packages/ui`, with a message naming `Breadcrumbs`. New rule
    R5c fails an `<li>`, `BreadcrumbItem`, `BreadcrumbList` or
    `BreadcrumbSeparator` passed as a crumb to `Breadcrumbs`.
  - `@groot/shell` (Storage) and `@groot/jobs` (JobDetail) render their
    breadcrumbs with `Breadcrumbs`. The markup is unchanged.
  - `@groot/web`: the skill, connection and connection tool pages use
    `Breadcrumbs`. The skill page's `Skills` crumb is now a real link with an
    `href`, so it can be reached with Tab and opened in a new tab.

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

- [#192](https://github.com/AshikNesin/tiny-agents/pull/192) [`b824aec`](https://github.com/AshikNesin/tiny-agents/commit/b824aeca84a0f3ae967d3612c1f394d694f3bea7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The client signs the owner out only when the session guard rejects the
  session, never on a credential failure.
  
  - `@groot/core`: the session guard (`jwtAuthMiddleware` and `verifyToken`)
    answers a missing, invalid or expired token with a 401 coded
    `SESSION_INVALID` (`ErrorCode.SESSION_INVALID`, thrown by the new
    `sessionInvalid()` in `utils/jwt.utils`). Before, it was coded
    `UNAUTHORIZED`. Every other 401, such as a wrong password, an unknown
    passkey or a missing admin key, keeps `UNAUTHORIZED`.
  - `@groot/shell`: `apiClient.onUnauthorized` handlers run only for a
    `SESSION_INVALID` response, not for every 401. A login form or step-up
    dialog that gets a plain 401 shows the server's message and the owner stays
    signed in. `UnauthorizedEvent` is unchanged.
  - `@groot/web`: a refused vault step-up (wrong password or unknown passkey)
    answers 401 with the server's message. The route no longer converts core's
    401 to 403 by hand.
- Updated dependencies [[`75fbeb5`](https://github.com/AshikNesin/tiny-agents/commit/75fbeb5d0967630ae0a2465821d693648303ac9a), [`6ed0fa4`](https://github.com/AshikNesin/tiny-agents/commit/6ed0fa4337bd0852bdb7580ffe740f4a898eaf48), [`ae0099b`](https://github.com/AshikNesin/tiny-agents/commit/ae0099bfe7b438b19fd865ea839c73948afa41f9), [`74eddfe`](https://github.com/AshikNesin/tiny-agents/commit/74eddfec119010ff3d63e04ede952e058101587b), [`80eb795`](https://github.com/AshikNesin/tiny-agents/commit/80eb79545ca683eb3db84ce44f0b01716cfea5c5), [`2987d1a`](https://github.com/AshikNesin/tiny-agents/commit/2987d1ab228b638bf08f7f792b9fa6d5f8eae667), [`af45885`](https://github.com/AshikNesin/tiny-agents/commit/af4588573840d89af0ff193d302fe6272a8c90f0), [`f598340`](https://github.com/AshikNesin/tiny-agents/commit/f598340325e146ab91cc988b4a85ca01ee134ae6), [`4bd27ac`](https://github.com/AshikNesin/tiny-agents/commit/4bd27ac3c83f67f4b4ad8d757f08248ea3333160), [`83ae1fd`](https://github.com/AshikNesin/tiny-agents/commit/83ae1fd3a967a9625171681c9d4059b3b3f65b47), [`b824aec`](https://github.com/AshikNesin/tiny-agents/commit/b824aeca84a0f3ae967d3612c1f394d694f3bea7), [`bc8cc60`](https://github.com/AshikNesin/tiny-agents/commit/bc8cc60182a4f056a526a53dca925d5384c636af)]:
  - @tiny-agents/agent@0.4.0
  - @groot/ui@0.11.0
  - @groot/shell@1.4.0
  - @groot/jobs@1.1.2
  - @tiny-agents/code@0.2.1
  - @groot/core@2.0.0

## 0.4.0

### Minor Changes

- [`ce03073`](https://github.com/AshikNesin/tiny-agents/commit/ce03073832f41256ca1789759fd9ab560d5a8025) Thanks [@claude](https://github.com/claude)! - Bot chat: the Code page's look. The header is one line with a hairline
  under it (the bot's name opens its settings; its description and model sit
  beside it). A turn's tool steps fold into one line ("Read the page ×3 ·
  1 failed"), across tool rounds too, so a bot that reads three pages shows one
  row above its answer instead of three. The composer gains the Code page's
  toolbar: "+" for files or mentioning a bot, a searchable model chip that
  switches the bot's model, Queue (Alt+Enter) while a reply runs, and a
  compact send/stop button. Queued and steering messages wait as compact rows
  over the composer. Past chats get the same one-line header (bot / chat).

- [#163](https://github.com/AshikNesin/tiny-agents/pull/163) [`bdf8b7b`](https://github.com/AshikNesin/tiny-agents/commit/bdf8b7b59f10c03651b3a6d72224aef06a6c428d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bot chat stream and chat session refactor; the UI looks and behaves as before.
  
  - One wire contract for the bot stream: `BotStreamEvent` and
    `EventsFeedEvent` (with `RoutineRunCard`, the `BotListEntry` row and a
    `Jsonified<T>` helper) live in `apps/web/src/shared` and type both the
    server's SSE writes (`openSse<E>`) and the client. The client re-exports
    the agent package's chat types instead of copying them.
  - `followBotChat(bot, sink)` (`bots.stream.ts`) owns every source of a bot's
    chat stream (viewer count, transcript window, routine cards, YOLO mode, the
    bot moving to another chat) and their order, on one per-bot event bus
    (`bots.events.ts`) that replaces three listener sets. Card and YOLO events
    that land while a stream starts are no longer lost to the first read.
  - A chat session owns the Echo and the outbox: `useChat(botId)` returns a
    ready-to-render view (timeline, outbox, busy, typing, health, unread
    divider, YOLO) and the chat's commands, from a pure reducer
    (`lib/chat-session.ts`) and a sessions store behind ports
    (`store/chats.ts`). The bots store's `adoptBot(bot)` stores a fresh row,
    drops a chat whose conversation changed and refreshes the list.
  - `viewOf(call, { readOnly })` (`lib/tool-call-view.ts`) decides how a tool
    call is shown; the chat's cards and rows derive from it.

- [#177](https://github.com/AshikNesin/tiny-agents/pull/177) [`104a668`](https://github.com/AshikNesin/tiny-agents/commit/104a668ba1b65d4ac590b29d4a2ee4d55de5e83f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One module decides a bot's toolkits: `apps/web/src/server/api/bots/bot-toolkits.ts`
  holds the list of built-in toolkit ids (`BOT_TOOLKITS`), the one parser for a
  connection's cached and disabled tools, the "large connection needs tool
  search" rule, and `botToolkits()`, the selection every bot's conversation runs
  with. The bot conversation and the ConnectionManager both ask it instead of
  keeping their own copies. At boot the server logs a warning if a bot would
  select a toolkit the runtime has not installed (such an id used to be
  ignored silently), and a test fails when the two drift apart. The server test
  runtime installs the app's own toolkits from the same source as the server
  (`appStoreCapabilities`). Every bot's selection is unchanged.

- [#150](https://github.com/AshikNesin/tiny-agents/pull/150) [`e14a12f`](https://github.com/AshikNesin/tiny-agents/commit/e14a12f917572c757f115e31402748e080bad20c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Claude plan: set `CLAUDE_CODE_ENGINE_ENABLED=1`, sign in once, and use it.
  The app now installs and runs the Claude Code worker on the sandbox itself
  (the VM or the local container) over the same SSH endpoint as the browser and
  terminal: Node when needed, the pinned Agent SDK and Claude Code, the bundled
  worker (`dist/server/claude-worker.mjs`), started on the sandbox's loopback and
  reached through an SSH tunnel: no `tailscale serve`, token or unit file.
  Settings → Claude plan shows the setup and login state and opens a terminal tab
  running `claude auth login` to sign in (`POST /terminal/sessions` takes
  `run: "claude-login"`, the Terminal page takes `?tab=`). The local sandbox image
  preinstalls Claude Code. **Breaking:** the hand-run worker is gone:
  `CLAUDE_WORKER_URL`/`CLAUDE_WORKER_TOKEN`, the macOS/Linux worker guides and the
  systemd/launchd files are removed; the sandbox is the only path. The worker now
  starts without a login (each session checks it), and the launcher unsets
  API-key and backend overrides. See ADR 0010.

- [#159](https://github.com/AshikNesin/tiny-agents/pull/159) [`1fc7691`](https://github.com/AshikNesin/tiny-agents/commit/1fc769128276b1c25b1e78f751d33de68fa10904) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code page harness adapters (issue [#157](https://github.com/AshikNesin/tiny-agents/issues/157), ADR 0011, ADR 0012): the Code page
  drives any coding agent through one adapter contract, starting with Shelley
  and Claude Code.
  
  `@tiny-agents/code` (new) holds the contract: `HarnessInstance`,
  `TranscriptItem` rows upserted by id, thread and instance events, honest
  `Capabilities`, `HarnessHost`, the drivers (`drivers/shelley`: Shelley's
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

- [#146](https://github.com/AshikNesin/tiny-agents/pull/146) [`34c54c9`](https://github.com/AshikNesin/tiny-agents/commit/34c54c94b64981d096181e8dfbfd3e72af622d45) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code page: a minimal UI modelled on Cursor's cloud agents and Claude Code on
  the web. Model, reasoning, working directory, repository and diff pickers
  are searchable (`SearchSelect`, type to filter); the model, reasoning and
  context ring live in the composer, whose send button becomes Stop while
  Shelley works; the header is one line with the actions in the title's menu;
  a run of finished tool calls folds into one "Ran 3 commands, edited 2 files"
  line; the list is one line per conversation; Changes stacks every changed
  file's diff in one scroll. Archive (on a row's hover, or the header) moves a
  conversation with all its subagents: `POST /shelley/conversations/:id/archive`
  and `/unarchive` now cascade to descendants and answer `subagents`, with Undo.
  Phones get a real new-conversation screen at `/code/new`.

- [#137](https://github.com/AshikNesin/tiny-agents/pull/137) [`248cb33`](https://github.com/AshikNesin/tiny-agents/commit/248cb33c6853447e1befd09d02ec0e16e543e5dc) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Adopt Fluid Functionalism components. `Dialog` and `AlertDialog` now spring in
  and animate out (staying mounted through the exit) with a deeper dark-mode
  overlay; `DialogContent` gains `size` (`sm` 400px default, `md`, `lg`, `xl`)
  and `position` (`center` / `top`) props, and `CommandDialog` anchors to the
  top. In the app, a bot's questions use the Fluid AskUserQuestions card
  (single-choice questions answer on a click or number key) and the typing dots
  are replaced by the ThinkingIndicator.

- [#137](https://github.com/AshikNesin/tiny-agents/pull/137) [`a0fb7fd`](https://github.com/AshikNesin/tiny-agents/commit/a0fb7fdb53bca28ae63c984f6356cfefb33345da) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Rebuild the remaining kit components on Fluid Functionalism's design, with
  their APIs unchanged. New `@groot/ui/motion` entry exports the shared
  `spring` tiers, `useModalPresence` and `FluidHighlight`.
  
  - `TabsList` slides its selected pill (or `line` underline) between tabs and
    shows a hover pill.
  - `Tooltip` is an inverted chip that springs in and fades out; the provider's
    delay drops to 200ms.
  - `Select`, `DropdownMenu` and the command menu share one gliding row
    highlight and a softer popup entrance; the picked select row is medium weight.
  - The command menu gets a borderless search line, brightening rows and a new
    `CommandFooter` of keyboard hints (hidden on touch); `CommandDialog` and the
    shell palette open top-anchored at `lg` width.
  - In the app: the switch thumb springs, stretches, squashes and can be
    dragged; owner messages are a soft tinted bubble and bot replies plain text,
    with time and copy in a hover row (always shown on touch) and a spring
    entrance for new messages; the composer has Fluid's ring frame and a
    send/stop button that morphs between states.

- [#177](https://github.com/AshikNesin/tiny-agents/pull/177) [`35642ff`](https://github.com/AshikNesin/tiny-agents/commit/35642ff1f684b8dddbef2cc77085b3f259cdcd96) Thanks [@AshikNesin](https://github.com/AshikNesin)! - One owner for a routine's armed state. `routines.arming.ts` (was
  `routines.chain.ts`) is the only module that writes `enabled`, `nextRunAt`,
  `pendingJobId`, `blockedStreak`, `pausedReason`, `conversationId` and the
  create-time `sourceKey`; the service, runs, fire job and toolkit store ask
  it for transitions (create, arm, disarm, advance, record blocked, clear
  streak, claim conversation, move to bot, remove). Each transition is one
  compare-and-set write, the job handle a write replaces is cancelled, and a
  job queued for a write that lost is cancelled too.
  
  Behaviour changes:
  
  - A routine the agent creates is inserted with its `sourceKey` (and already
    armed) in one statement, so a replayed tool call can no longer create a
    duplicate routine after a crash or a race mid-create.
  - Advancing the chain after a fire only moves it while the handle is still
    the one the fire loaded: an edit or pause that landed meanwhile wins, where
    before the fire could leave a second chain or re-arm a paused routine.
  - The third blocked run in a row pauses the routine and records the reason in
    one write.
  
  A bot chat handle. `openBotChat` (`bots/bots.chat.ts`) looks a bot up once
  and resolves its current conversation to a `ConversationRef`; the owner's
  chat actions (read, page, abort, withdraw, approvals, questions, YOLO) act on
  that ref. `conversationRef` (`bots.conversation.ts`) is the one place a stored
  conversation id becomes a ref. Owner-wait errors are translated to HTTP in
  one table (`OWNER_WAIT_ERRORS`), which the vault's credential requests use
  too; status codes and messages are unchanged.

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

- [`3d7ff0b`](https://github.com/AshikNesin/tiny-agents/commit/3d7ff0beec2defda84deae884056c4600a5a2d0b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code page: clicking the context meter in the composer opens a usage popup
  (Shelley's own context-usage table, ported): total and subtotal, per-model
  token bands (cache read/write, input, output) with models.dev rates and
  estimated cost, "Other (indirect)" rows (compaction, slug generation, …), a
  sub-agent column when children exist, and "Compact in place". Pricing is
  looked up through a new curated proxy route, `POST /shelley/model-costs`.

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

- [`fc98270`](https://github.com/AshikNesin/tiny-agents/commit/fc98270fe39983a7f47451733a8249624568667e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add a `DATA_DIR` environment variable for the production data directory (default `/data`, so Docker behavior is unchanged). Outside Docker (e.g. a bare-metal macOS run) `/data` is not writable and boot failed with `ENOENT: mkdir /data`; set `DATA_DIR` to a writable path to move the app database (`app.db`), agent store (`agent.db`) and their sibling uploads directory together. Explicit `DATABASE_URL` / `AGENT_DB_PATH` / `UPLOADS_DIR` values still win.

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

- [#163](https://github.com/AshikNesin/tiny-agents/pull/163) [`603d3fd`](https://github.com/AshikNesin/tiny-agents/commit/603d3fd1df8dc733d253d15060ed2ea65d590b84) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Relay @mention and bot-to-bot replies that take real model time. Boot built
  the Delivery answerer before the agent runtime had opened, so every relay
  from a conversation's settling (and the boot sweep) failed against an
  undefined runtime; only replies that finished before the submit returned
  were relayed. The answerer is now built from the opened runtime.
  
  Server internals behind it:
  
  - `startSettledPipeline(runtime, { notifier, memoryCapture })` builds every
    Settled step from the opened runtime, in the glossary's order, subscribes
    once, resets the bot-to-bot per-turn budget, and runs each step's boot
    sweep after subscribing. Boot has one "settled conversations" part.
    Routine runs read only the settled conversation's awaiting rows.
  - `createSideCaller(runtime)` runs memory capture and Past chat title calls:
    model choice, a deadline that aborts the call (a timed-out capture no
    longer keeps spending tokens), failure detection and logging in one place.
  - `memoryLedger(botId)` applies the memory rules (dedupe, tombstones,
    supersession, expiry, budget, the capture watermark) to every write.
    Memory page adds now dedupe: adding text the bot already has returns that
    memory, and adding a removed or archived one brings it back instead of
    creating a second row. A restored memory is kept past a full budget
    instead of being archived again at once. Capture no longer lists expired
    memories as current, and only supersedes active ones.

- [#175](https://github.com/AshikNesin/tiny-agents/pull/175) [`e017985`](https://github.com/AshikNesin/tiny-agents/commit/e017985c00e325edeb018761b9de854276fe9fe3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fixes for bugs found by the verify-tiny-agents full pass:
  
  - Vault: a refused step-up (a wrong password, someone else's passkey, or a
    passkey the server does not know) is answered with 403, not 401, so the
    owner is no longer signed out and keeps unsaved edits ([#164](https://github.com/AshikNesin/tiny-agents/issues/164)).
  - Chat attachments: the enlarged image viewer is portalled to the page, so it
    covers the window instead of being clipped to its message row ([#165](https://github.com/AshikNesin/tiny-agents/issues/165)).
  - ⌘K palette: the app's own Navigation, Theme and Account groups are no longer
    listed a second time by the shell, and Code no longer shows when no coding
    agent is configured ([#166](https://github.com/AshikNesin/tiny-agents/issues/166)).
  - Chat composer: "+ → Mention a bot" leaves focus in the composer, so the
    mention list opens ([#167](https://github.com/AshikNesin/tiny-agents/issues/167)).
  - Jobs: `/jobs/:jobId` is mounted, so job rows and the Add Job / Re-run toast
    links open the job instead of falling through to the chats ([#169](https://github.com/AshikNesin/tiny-agents/issues/169)).
  - Terminal: in full screen, the exit control sits inside the terminal region,
    so the CSS full screen used where the Fullscreen API is missing (iPhone
    Safari) can be left again ([#170](https://github.com/AshikNesin/tiny-agents/issues/170)).
  - Settings → Claude plan: with the engine off, the card no longer claims that
    no sandbox is configured ([#171](https://github.com/AshikNesin/tiny-agents/issues/171)).
  - Bots: deleting a bot with its own browser profile also closes its own
    desktop and wipes that desktop's profile on the sandbox, as it already did
    for its browser.
- Updated dependencies [[`89350a0`](https://github.com/AshikNesin/tiny-agents/commit/89350a09bf8ecc5949e381b5a9c27eed3315ab80), [`2cb4ea8`](https://github.com/AshikNesin/tiny-agents/commit/2cb4ea8e9fd925ccac5e662dc7ed203b1ca71727), [`756aa4b`](https://github.com/AshikNesin/tiny-agents/commit/756aa4b7d0ed378ed248b6d306c385b2e97e38d0), [`e14a12f`](https://github.com/AshikNesin/tiny-agents/commit/e14a12f917572c757f115e31402748e080bad20c), [`ff9c364`](https://github.com/AshikNesin/tiny-agents/commit/ff9c3643377ed3a0bc379f0b8690a6cd846f9ab7), [`1fc7691`](https://github.com/AshikNesin/tiny-agents/commit/1fc769128276b1c25b1e78f751d33de68fa10904), [`a47cc42`](https://github.com/AshikNesin/tiny-agents/commit/a47cc42036b90e6b9f0b1f3dd0f3d517c32b434e), [`ea8011c`](https://github.com/AshikNesin/tiny-agents/commit/ea8011cae6f77836511661722567a1c72f21f9e8), [`248cb33`](https://github.com/AshikNesin/tiny-agents/commit/248cb33c6853447e1befd09d02ec0e16e543e5dc), [`a0fb7fd`](https://github.com/AshikNesin/tiny-agents/commit/a0fb7fdb53bca28ae63c984f6356cfefb33345da), [`bb9fec6`](https://github.com/AshikNesin/tiny-agents/commit/bb9fec6089651c66d975c919884be5690d0d4833), [`5563dcd`](https://github.com/AshikNesin/tiny-agents/commit/5563dcd9d3f3fde3f338d0150a426dba854866de), [`f83139d`](https://github.com/AshikNesin/tiny-agents/commit/f83139da1ddcf6e9861b71ffab229c9e7fc5e757), [`07ef32e`](https://github.com/AshikNesin/tiny-agents/commit/07ef32ec5092a30c17e8668c1931b04867c705c2), [`56c0bd5`](https://github.com/AshikNesin/tiny-agents/commit/56c0bd51e1de477542d21c2361c047686e32b6e1), [`18498d5`](https://github.com/AshikNesin/tiny-agents/commit/18498d57e533d3db6bbd812fa62cade3e18ad74a), [`c4759b1`](https://github.com/AshikNesin/tiny-agents/commit/c4759b13157722cac114bb5d24eb2f560dc880a1), [`10a1504`](https://github.com/AshikNesin/tiny-agents/commit/10a150410f40c44df1060c4cb89d054e01218c79), [`4ee6a86`](https://github.com/AshikNesin/tiny-agents/commit/4ee6a864e003e31faeb1a6848388f423456b7570), [`501ed71`](https://github.com/AshikNesin/tiny-agents/commit/501ed71b7d370bf76c625f42a25eb6b7a3521705)]:
  - @tiny-agents/agent@0.3.0
  - @tiny-agents/code@0.2.0
  - @groot/core@1.2.0
  - @groot/shell@1.3.0
  - @groot/ui@0.10.0
  - @groot/jobs@1.1.1

## 0.3.0

### Minor Changes

- [`998668e`](https://github.com/AshikNesin/tiny-agents/commit/998668e8f9612c282ce193f838bf826eab50c602) Thanks [@claude](https://github.com/claude)! - Bots can ask the owner clarifying questions mid-reply (human in the loop).
  The new `ask_owner` tool (runtime-installed `questions` capability, read-only)
  takes 1–4 questions with optional options and multiple choice, and waits
  durably: the approval gate's wait, now shared as `waitForOwner`/`WaitTracker`
  in `waiting.ts`, until `AgentRuntime.answerQuestions` records the answers or
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

- [#112](https://github.com/AshikNesin/tiny-agents/pull/112) [`cf3f3b7`](https://github.com/AshikNesin/tiny-agents/commit/cf3f3b71bda99040f328d04ab2e54e48ef568185) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Computer page: `/computer` (in the sidebar beside Terminal) shows the bots'
  desktops on the sandbox VM, one tab per desktop (the shared one and one per
  bot with its own browser profile). Each streams live and can be driven
  directly: Take control pauses the bots on it (and answers a bot's takeover
  request on release), and while driving the page opens installed apps, sends
  the shortcuts the local browser would keep (Alt+Tab, Alt+F4, Ctrl+W, Alt+F1
  menu, Ctrl+Alt+T terminal), pastes the clipboard, goes full screen, and
  starts or resets a desktop. New routes under `/api/v1/computer` and a
  `/computer/:profile/vnc` viewer socket with its own tickets; the chat's
  Computer panel links to the page.

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

- [#55](https://github.com/AshikNesin/tiny-agents/pull/55) [`601772a`](https://github.com/AshikNesin/tiny-agents/commit/601772a74aff3dc4542b763f9faf43e62835479f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Turn individual MCP connection tools on or off for every bot, and open any tool on its own page. Each row in a connection's tool list now has a switch and links to `/connections/:id/tools/:tool`, which shows the tool's description, behavior hints (read-only, idempotent, destructive, open world), input and output schema (as fields or raw JSON Schema), an "Available to bots" switch, and a playground that calls the tool on the live server from a generated form or a JSON editor. Tools that may change data ask before running. Turned-off tools are kept in the new `Connection.disabledTools` column, are never installed into the runtime (so no bot sees them, whatever its own permissions say), and stay off across reconnects; tools a server adds later start on. New endpoints: `GET`/`PATCH /connections/:id/tools/:tool` and `POST /connections/:id/tools/:tool/call`. The agent package's cached MCP tool info now carries `outputSchema` and the destructive/open-world hints, and call results carry `structuredContent`.

- [`2e60f7b`](https://github.com/AshikNesin/tiny-agents/commit/2e60f7ba3404b8bff5985ccf3a9828d7393c53c5) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Deliveries, routine runs and the chat's Echo are each owned by one module.
  
  - Deliveries (`bots.delivery.ts`): the ledger row is written before the
    submit and pinned to the target conversation (new `bot_messages.conversation_id`
    column, migration `0002`), and the answer is the Finished reply to the
    Delivery's request id. A reply is no longer missed when the target answers
    before the row was marked delivered, nor lost when the target starts a new
    chat, and a mid-turn "Let me check…" is no longer relayed as the answer. A
    failed reply relays a short note instead of nothing.
  - Routine runs (`routines.runs.ts`): every run state change, the blocked
    streak and the announcement live in one module; the chain (`routines.chain.ts`)
    and the fire job no longer import each other in a cycle. Two "Run now"
    clicks in the same second are two runs. The boot sweep resolves a run whose
    reply finished just before a restart instead of marking it interrupted.
  - A conversation that settles answers its Deliveries, resolves its routine
    runs and updates the bot list in that order, from one transcript read
    (`bots.settled.ts`).
  - Attachment resolution moved to `uploads.attach.ts`.
  - Chat: an offline resend reuses the message's request id, so a send whose
    answer was lost is never placed twice, and a repeated "ok" no longer clears
    a newer Echo. The live chat and Past chats share one Transcript; approval,
    vault and question cards act through an owner-actions port.

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

- [#102](https://github.com/AshikNesin/tiny-agents/pull/102) [`e7c16c0`](https://github.com/AshikNesin/tiny-agents/commit/e7c16c090e81bd0fd63f6898596a96e477ea96a7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Past chats (issue [#101](https://github.com/AshikNesin/tiny-agents/issues/101)). "New chat" no longer hides the chat it replaces: the
  chat header has a Chat history button (also in the sidebar row's ⋯ menu)
  listing each bot's earlier chats with a title, dates and a preview. Opening
  one shows it read-only, with older messages loading on scroll and the routine
  results from that period. From there you can continue the chat (the bot moves
  back onto it, and the chat it was on becomes a past chat) or delete it.
  Titles come from one lightweight side-call per "New chat" (`CHAT_TITLE_MODEL`,
  default `custom:custom-zai-coding-plan/glm-5.3-flash`), with the first
  message as the fallback. Adds the `BotChat` table (migration
  `20261030170000_bot_chats`). Chats ended before this release can't be
  recovered: nothing linked them to their bot.

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

- [#49](https://github.com/AshikNesin/tiny-agents/pull/49) [`786e799`](https://github.com/AshikNesin/tiny-agents/commit/786e799d53e2a6e58f053fb49d6c228e260eb27c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bots share one browser profile by default. The browser toolkit now keys live
  browsers by profile (`BrowserTarget`: profile plus tab): bots on one profile
  share one Chrome, and so its logins, each driving a tab of its own, with the
  acting bot's tab brought to the front. A bot can be switched to its own
  profile in the bot dialog (new `browserProfile` column, `"shared"` or `"own"`).
  Taking control and Reset act on the whole shared browser; the panel warns
  before a reset signs every bot out. Existing per-conversation profiles are no
  longer used, so sites need one fresh sign-in on the shared profile.

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

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`e4ad519`](https://github.com/AshikNesin/tiny-agents/commit/e4ad51990883f2d447991afcf3a0571e054e3fef) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Accessibility fixes from an axe-core pass; every page now scans clean in light
  and dark mode. The Jobs page's icon buttons (row actions, the extra job states
  menu) have names, its state filter no longer puts a menu inside the tab list
  or points at tab panels that do not exist, and the Storage page's icon buttons
  and select column are labelled. Red status text (failed, error, expired badges)
  and blue folder names now meet 4.5:1 contrast in both themes. The chat page has
  a top-level heading (the bot's name), Settings headings no longer skip a level,
  the composer hint and the new row and message times are readable, and the
  feedback form's type buttons have names.

- [#48](https://github.com/AshikNesin/tiny-agents/pull/48) [`bbf5163`](https://github.com/AshikNesin/tiny-agents/commit/bbf5163dae529c1fd7ee8f79dfd65003c89014fc) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Friction pass across the app:
  
  - Phones open the sidebar drawer from every page's menu button; detail pages
    go back to their list instead of to Chats, and the bot list reads "Chats".
  - Tasks: a task added on Today stays on Today (it used to land in Upcoming),
    due dates read "Today" / "Tomorrow" instead of "11:59 PM", and completing a
    task offers Undo.
  - Routines: a new routine starts daily on your most recent bot, the name is
    optional (it defaults to the prompt's first words), the schedule tabs no
    longer wrap over the input on phones, Run now links to the bot's chat, and
    the Upcoming list only shows once there is more than one routine.
  - Skills: the instructions editor is a real editing area, bot assignment
    sits right under the details (with a hint while no bot uses the skill),
    and the description no longer repeats in the header.
  - Connections hides the empty "Connected" group; Terminal hides its tab
    tools while the sandbox is down.
  - Creating a bot right after sign-in no longer bounces you to another chat
    (an older bot-list response could land after the newer one).
  - Bot-to-bot: a tagged bot's reply is relayed only once it finishes; it was
    relayed half-written whenever another chat went idle first.

- [#46](https://github.com/AshikNesin/tiny-agents/pull/46) [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Declutter the inner pages: Routines shows one empty state until a routine
  exists (Upcoming and Recent runs appear only when they have something to
  show), empty states on Routines, Skills and Connections drop the button that
  duplicated the header action, Skills hides its search until there are skills,
  the per-bot memory switch says On/Off, and the FeedbackBee launcher is
  smaller on phones.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`666cafd`](https://github.com/AshikNesin/tiny-agents/commit/666cafd7c4ddcd692fd31aa1ef5dd847b842f348) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Approval cards now say what the bot wants to do in plain words: "Chief wants to
  open a page", "wants to delete a task", "wants to run a routine now", instead of
  "wants to opened a page" built from the past-tense label the transcript shows
  afterwards. Every built-in tool carries an imperative `askLabel` next to its
  `label` in the capabilities API, and tools without one (connection tools) read
  "wants to use <tool name>". The Always allow button's tooltip uses the same
  wording.

- [`dbfaaf4`](https://github.com/AshikNesin/tiny-agents/commit/dbfaaf4e9acb0b79ec6a9a53079c7d12529d8ac9) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Approval cards fold long payloads behind a Read more toggle: approving an
  update_instructions change showed a 60-character slice of what can be a
  700-word rewrite. The full text expands in a scrollable block.

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

- [`d0c92af`](https://github.com/AshikNesin/tiny-agents/commit/d0c92af4b6a9feaa13248631cbf234f9ba817cc6) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bot-to-bot messages follow Grok's pattern: a quiet centered "Messaged {bot}" line that opens the full message in a view-only thread dialog, and incoming peer messages labelled with a centered "{bot} · messaged you" header above a normal bubble.

- [`a111ade`](https://github.com/AshikNesin/tiny-agents/commit/a111ade11c5551a018328c218b34f4807f0c3b70) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Make the selected chat bot visibly distinct in the bot list.

- [`58ad432`](https://github.com/AshikNesin/tiny-agents/commit/58ad4328986aa69ed7281425ceae42ba254e3d46) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bot-to-bot relay fix: each delivered message is now answered by the
  assistant reply that actually follows it, not the target's latest reply.
  A restart sweep can no longer relay a stale pre-delivery reply, and two
  messages queued to the same bot each get their own answer relayed back
  (one reply could previously answer both, losing the second). Hand-typed
  mentions also match case-insensitively ("@ada" reaches "Ada") and the
  composer placeholder hints at "@ to tag a bot".

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

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`06fdac7`](https://github.com/AshikNesin/tiny-agents/commit/06fdac7638764f2f6d36ba57fbe86b35191f3dc1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Browser panel on tablets and small laptops: the panel now sits beside the
  chat only on wide screens (1280px and up), and never so wide that the chat
  gets less than about 26rem. On narrower screens it opens over the chat with
  its close button in reach, like on phones. Before, at 1024px the chat shrank
  to a sliver with text wrapping one letter per line, and at 820px the composer
  was 32px wide and the panel's close button was off the screen.

- [#62](https://github.com/AshikNesin/tiny-agents/pull/62) [`ea57861`](https://github.com/AshikNesin/tiny-agents/commit/ea5786131b3ff1637723bfe9c7b080f1d72d7672) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Browser panel stays closed once you close it. It still opens on its own the
  first time a bot uses its browser in a conversation, but after you close it,
  later browser calls in that run, the next run or after a reload no longer pop
  it back over the chat (on a phone it covered the whole transcript). Before, any
  new message in the transcript re-armed the auto-open. The header's Browser
  toggle now shows on mobile too, with a pulsing dot while the bot is browsing
  and the panel is closed. A new chat starts fresh. The faux e2e model gains
  `/browse N` to exercise this.

- [#46](https://github.com/AshikNesin/tiny-agents/pull/46) [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Polish the bot conversation UI. The composer now shows one action button
  (Stop while a reply runs with nothing typed, Send/Steer otherwise) instead
  of Stop and Send side by side, Esc stops a reply, and the composer keeps
  focus after sending. Streaming replies follow the bottom of the transcript
  again instead of snapping back to an older read message. Opening a chat no
  longer flashes the empty state or a "Reconnecting…" banner before the first
  snapshot, and replies to messages sent while the chat is open are no longer
  flagged "New messages". Also: a typing indicator while the bot works with
  nothing to show yet, a reasoning block that collapses when done, per-bot
  unsent drafts, drag-and-drop attachments, a reconnecting notice that
  actually appears when the stream drops, and the FeedbackBee launcher no
  longer covers the send button on phones. The composer moved out of
  ChatPane into its own ChatComposer component.

- [#46](https://github.com/AshikNesin/tiny-agents/pull/46) [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Declutter the chat header: the bot's name (with a small chevron) opens its
  settings, and the right side holds just two quiet icons: the browser panel
  toggle and a new-chat pen (⇧⌘O / Ctrl+Shift+O; disabled on an empty chat).
  The ⋯ menu is gone: Delete moved into the edit dialog with an inline
  confirmation, and Pin stays in the sidebar row's menu.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`a3c31c7`](https://github.com/AshikNesin/tiny-agents/commit/a3c31c790262a4747d64e9b3bdbfd4d7e15eb4b1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Long chats open fast and stay fast. Opening a chat, reconnecting, or catching
  up after a slow connection used to send and render the whole conversation,
  which grows forever (one conversation per bot). The live stream now starts
  with the newest 60 messages; scrolling up loads earlier messages 50 at a time
  (`GET /api/v1/bots/:id/messages?before=…`) without moving what is on screen,
  and a reconnect keeps the history already loaded.

- [`1f04200`](https://github.com/AshikNesin/tiny-agents/commit/1f0420097a3a2cb2a211dde7c5edbf930d9baac2) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix three chat UX issues: Enter inserts a newline on touch devices (send via
  the button only), sending scrolls the transcript to the newest message, and
  conversations open at the last read message with a WhatsApp-style "New
  messages" divider above unread replies.

- [#47](https://github.com/AshikNesin/tiny-agents/pull/47) [`59bdae6`](https://github.com/AshikNesin/tiny-agents/commit/59bdae6814e5790a3f9a135987e4d22b51144743) Thanks [@AshikNesin](https://github.com/AshikNesin)! - `/chats` is no longer a page of its own on desktop: it opens the bot you
  opened last (else the sidebar's top bot), so login, the logo and deleting
  the open bot land in a conversation instead of an empty pane. The sidebar
  drops its "Chats" row, since the Bots list is the way into chats. Phones
  keep `/chats` as the bot list, and with no bots it is still the "Create
  your first bot" screen.

- [`a111ade`](https://github.com/AshikNesin/tiny-agents/commit/a111ade11c5551a018328c218b34f4807f0c3b70) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Validate the Add connection dialog instead of silently disabling Save. Name and URL are now required with an inline "Enter a name" / "Enter a valid https:// URL" hint after the field is touched, the URL must parse as an http(s) URL, header auth explains its missing secret, and the hidden Test connection button (OAuth) says why: "Sign-in (OAuth) is tested after saving".

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`2cb97ff`](https://github.com/AshikNesin/tiny-agents/commit/2cb97fffd97ace0cd763e6c3984289dc0d2420aa) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Deleting a bot now closes its browser tab. In the shared browser its tab
  closes (or, if it was the browser's first tab, goes blank and is freed) and the
  other bots' tabs stay as they are; a browser that no bot uses any more closes.
  A bot with a browser of its own has that browser closed and its profile
  (cookies and logins) wiped. Before, the tab stayed open next to other bots'
  tabs until the whole shared browser went idle.

- [`16cfe00`](https://github.com/AshikNesin/tiny-agents/commit/16cfe00b63d9d8ffb29efc4e058d0290dc6e2b40) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Tall dialogs keep their header, tabs and footer pinned and scroll only the middle. `DialogContent` is now a height-capped flex column and `@groot/ui/dialog` exports a `DialogBody` scroll region; the bot, routine, skill import/create and connection dialogs use it.

- [`4acade6`](https://github.com/AshikNesin/tiny-agents/commit/4acade61b191a8f92344dad55c260760ca26ca64) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fixes from the E2E friction audit (issues [#119](https://github.com/AshikNesin/tiny-agents/issues/119), [#121](https://github.com/AshikNesin/tiny-agents/issues/121)–[#124](https://github.com/AshikNesin/tiny-agents/issues/124), [#127](https://github.com/AshikNesin/tiny-agents/issues/127)). The
  /memory page no longer sticks on "No bots yet" when its bots load loses a
  race with the app shell's. The skills and connections dialogs validate
  inline and surface test-connection failures in the dialog. The vault's
  New item is disabled with a reason while the primary backend can't save,
  and its failures read "SECRETS_KEY is not set." instead of the bare code
  "unconfigured". The mobile drawer lists Routines, Skills, Memory,
  Connections and Vault directly. Dev and Playwright boot the server with a
  1024MB heap cap; 512 OOM-crashed at startup.
  
  Follow-up (prod verification): three overlapping `loadBots` generations
  (mount, page, SSE) stranded the oldest caller's promise forever: a
  superseded middle generation carried waiters that only the newest request
  settles. Stranded waiters now carry forward to the newest generation (or
  answer from its recorded outcome when it already landed).

- [`a111ade`](https://github.com/AshikNesin/tiny-agents/commit/a111ade11c5551a018328c218b34f4807f0c3b70) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Restyle the featured bot on the chats empty state as an inactive shortcut
  (issue [#8](https://github.com/AshikNesin/tiny-agents/issues/8)): smaller muted avatar, non-heading name, and an explicit "Select a
  bot to start chatting, or create one." hint so it no longer reads as an open
  conversation missing its composer.

- [#46](https://github.com/AshikNesin/tiny-agents/pull/46) [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Move feedback into the sidebar's account menu: "Send feedback" opens the
  FeedbackBee panel as a centered modal over a dimmed backdrop (an outside
  click closes it while nothing is typed or attached), and the floating
  launcher is hidden wherever the sidebar is shown (signed-out pages keep it). E2E logins now
  target the login form's Email field exactly, since FeedbackBee adds an
  "Email (optional)" field to every page.

- [`e78e26d`](https://github.com/AshikNesin/tiny-agents/commit/e78e26d15b5b72f8af4951bf25e486d4314e3196) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add the FeedbackBee feedback embed (`embed.js`, project `tiny-agents`) to the app HTML so users can send feedback from the web app.

- [`a111ade`](https://github.com/AshikNesin/tiny-agents/commit/a111ade11c5551a018328c218b34f4807f0c3b70) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Keep the active bot row read after opening it, and show its typing indicator
  as soon as reply activity begins.

- [`a111ade`](https://github.com/AshikNesin/tiny-agents/commit/a111ade11c5551a018328c218b34f4807f0c3b70) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add command palette actions for creating and opening bots.

- [`a111ade`](https://github.com/AshikNesin/tiny-agents/commit/a111ade11c5551a018328c218b34f4807f0c3b70) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix the login demo-credentials spacing and report failed message-copy attempts.

- [`8dd01ad`](https://github.com/AshikNesin/tiny-agents/commit/8dd01ad7f48d3326a124eb838f0b9061797f31c7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix memory capture discarding short preferences: use a 24-byte owner-text threshold, the bot's own model instead of a hardcoded gateway model, assistant context, and today's date. Preserve the watermark and log returned model errors. Exclude peer/routine exchanges from capture.
  
  Add an approval-gated `remember` tool for immediate chat-side saves. Saves share background capture's transaction, dedupe (including deleted memories), and budget without advancing its watermark. Existing read-only memory adapters remain compatible.

- [`c45a691`](https://github.com/AshikNesin/tiny-agents/commit/c45a691d6b084adc29f0fd221acdfe05705a3dee) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Friction-audit fixes for the chat and task surfaces:
  
  - The "New messages" divider in a chat now anchors to the first unread
    _assistant_ reply instead of the first unread row, so it no longer sits
    above your own just-sent message.
  - The browser panel auto-opens once when the bot runs a `browser_*` tool
    call, so the noVNC view is visible while the agent drives it.
  - The composer caps its growth (`max-h-40` + internal scroll) instead of
    pushing the transcript off-screen on long drafts.
  - Tool-trace detail blocks scroll internally (`overflow-y-auto`,
    `overscroll-contain`) and expand scrolls the row into view, so long tool
    output no longer hijacks page scroll.
  - Chat bubbles use `max-w-[92%]` on mobile / `80%` on desktop with tighter
    gutter padding on small screens.
  - The Tasks "Upcoming" quick-add defaults `dueAt` to tomorrow 23:59 so
    tasks land in the tab they were created from; placeholder says so.
  - Selects in Routines/Tasks/Memory/Connections render as `popper` dropdowns
    with a height cap.
  - The command palette gains Settings navigation, a Theme group
    (Light/Dark/System), and Account actions (Log out).
  - Logout from the sidebar account menu or the palette confirms with a toast.
  - Light-theme `--fg-tertiary` darkened to #6b6b6b for contrast on the
    light background.

- [`046443a`](https://github.com/AshikNesin/tiny-agents/commit/046443a45d56e86449b241eea4a9c924a2b5ee22) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Restyle the bot dialog (wider, larger avatar, soft tool and skill cards) and apply the Grok-style radius and control sizes across the Tasks, Skills, Memory, Routines, Connections and Settings pages.

- [#27](https://github.com/AshikNesin/tiny-agents/pull/27) [`3944039`](https://github.com/AshikNesin/tiny-agents/commit/39440393d04314b7cd9e8afbf5f8fb72105d0a2d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Grok Bots-style UI: an app-wide collapsible sidebar (search, nav, Pinned and Recent bots), restyled conversation header, bubbles and composer, and a warm monochrome palette. Bots can be pinned (`pinnedAt` column, `POST /api/bots/:id/pin`, new migration for SQLite and Postgres).

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`a5e8978`](https://github.com/AshikNesin/tiny-agents/commit/a5e897848ac8aa04234f0bad2c5e03fedb97d245) Thanks [@AshikNesin](https://github.com/AshikNesin)! - The Inter font loads in production again. The production build kept the
  font's relative `url(./files/*.woff2)` references but never copied the files,
  so browsers got the app's HTML instead of a font and fell back to the system
  typeface. The font is now imported from the app entry, so the build emits the
  `.woff2` files with hashed names.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`7a0bb93`](https://github.com/AshikNesin/tiny-agents/commit/7a0bb937223c095d004923ca4dc0bae6b03404f6) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Signing in now takes you to the page you were trying to open (a link from a
  notification, a bookmarked `/routines`, …) instead of always landing on the
  chats. Works for password and passkey sign-in; only in-app paths are used.

- [`60b62b9`](https://github.com/AshikNesin/tiny-agents/commit/60b62b9c8403032f31a997921e80c613368f654b) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix MCP OAuth sign-in failing after the provider redirects back: the callback route sat behind the JWT middleware, but the return from the authorization server is a cross-site navigation with no session cookie (SameSite=Strict in production) and no Authorization header, so it failed with `UNAUTHORIZED "No token provided"`. The callback is now public (like the client metadata document) and is authorized by the OAuth `state` parameter, which matches only a pending sign-in started by the connection's owner.

- [#23](https://github.com/AshikNesin/tiny-agents/pull/23) [`d3edec4`](https://github.com/AshikNesin/tiny-agents/commit/d3edec495049d15abdd18b5c7832224ef4a25e93) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Adds durable per-bot memory (issue [#22](https://github.com/AshikNesin/tiny-agents/issues/22) phase A): a `memories` table with a typed lifecycle (active/superseded/archived/expired/deleted), a `memory` capability section that injects what a bot remembers about the owner into its prompt on every send, `Bot.memoryEnabled` with capture/injection gating, and REST CRUD under `/api/v1/bots/:id/memories` with tombstone deletes that block exact-text re-capture. Overflow archives the oldest active rows at a 100-row budget, never truncating new facts.
  
  Capture (phase B): idle chats arm a per-conversation debounce (2 minutes quiet or 6 owner turns); one gateway side-call reads the owner turns since the watermark through an anti-junk extraction contract, and code alone decides what lands, exact-text dedupe against tombstones, same-bot supersession, budget archive, watermark bump in one transaction. Trivial windows and peer/routine turns never trigger a call; faux mode and missing gateway config disable capture without affecting manual memories or injection.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`4c060ba`](https://github.com/AshikNesin/tiny-agents/commit/4c060bae2d002873623dfeac75ca0f68ad3674cf) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Memory page: bots that have memories now come first (most memories first),
  and bots without any are listed once at the end in a compact "No memories yet"
  list with their Add and on/off controls, instead of a full "Nothing yet"
  section each. With many bots, the one that remembered something no longer sits
  under ten empty sections. The on/off switch now says what it controls
  ("Learns from chats" / "Not learning"), and the page notes that each bot keeps
  its own memories.

- [`c9fa54e`](https://github.com/AshikNesin/tiny-agents/commit/c9fa54e1d052a234608dcded83decb5fe65bbf5e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Add message steering: sending while a bot is replying no longer blocks. Enter (or the send button, which stays live beside Stop) submits the message as a steer that joins the running reply after its current tool round; Alt+Enter queues a follow-up answered by the next run. Held messages render inline as tagged bubbles ("Steering into the reply" / "Queued for the next reply") with a cancel (x) that withdraws them, survive a reload from the server's durable queue, and flow into the transcript once placed. Cross-bot deliveries keep the queued-follow-up behavior.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`e89ffd1`](https://github.com/AshikNesin/tiny-agents/commit/e89ffd156e74ccee029e7436b4944d784fbd20ce) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Chat feels more like a messenger. Hover (or tap) a message to see when it was
  sent ("14:05", "Mon 14:05", "12 Oct, 14:05", full date in the tooltip). Bot
  rows in the sidebar show the last message and how long ago it was ("5m",
  "Yesterday"). The chat header shows the bot's description next to its name on
  wide screens. The composer placeholder is just "Message {bot}"; the "type @ to
  tag another bot" tip moved under the composer and goes away once you have used
  a mention.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`d71ed4d`](https://github.com/AshikNesin/tiny-agents/commit/d71ed4d9770e04d786aa691cc2b33e53dbdc97af) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A bot waiting on you is now visible wherever you are. The collapsed sidebar
  shows the open bot, pinned bots and any bot that is waiting on you, replying or
  unread, as avatars with a count or dot (it used to show no bots at all). The
  browser tab is titled after the page, e.g. "Chief · tiny-agents", and starts
  with the number of approvals and questions waiting, e.g. "(2) Chief ·
  tiny-agents"; the favicon gets a red badge while anything is waiting.

- [`280ee0b`](https://github.com/AshikNesin/tiny-agents/commit/280ee0b2f58f98491c5241f76bb4e5d718a76970) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix "New chat" not clearing the transcript, and a blank-screen crash when opening the New bot dialog.
  
  - New chat: the SSE stream stays bound to the bot's old (retired) conversation, so after a reset the stale transcript stayed on screen and kept growing. The chat store now drops the cached ChatState on reset (`resetChat`) and the chat pane reconnects its stream when the bot's `conversationId` changes: the fresh snapshot of the new conversation replaces the old transcript.
  - New bot dialog: `/api/v1/capabilities` returns `{ capabilities }`, but `botsApi.capabilities()` was typed as the bare array, so `capabilities.filter` in BotDialog threw `TypeError: capabilities.filter is not a function` during render and unmounted the whole React tree (blank page). The client now unwraps the envelope.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`e6005bd`](https://github.com/AshikNesin/tiny-agents/commit/e6005bde2cfcf1cc1120cf9e23741fccce5c51fb) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Chat knows when you are offline. Going offline used to leave the chat looking
  live while nothing arrived, and a message sent meanwhile failed with a brief
  "Network Error". Now a "You're offline" notice shows right away, the live
  stream reconnects (with a fresh copy of the chat) the moment you are back
  instead of after its retry delay, and a message you sent while offline stays in
  the box and sends by itself once you are back online.

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

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`a0cf2d2`](https://github.com/AshikNesin/tiny-agents/commit/a0cf2d2cf1e69066e8f440a0769309160b1c08b3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Errors now say what went wrong. Toasts and inline errors across the app
  (bot dialog, skills, tasks, chat, browser panel, attachments, vault) showed
  axios's "Request failed with status code 400/409" instead of the server's
  reason. A shared `errorMessage()` helper now shows the first validation
  message (for example "System prompt is too long (max ~24 KB)"), then the
  server's message, and plain words when the server could not be reached. The
  system prompt field also stops at the 24 KB limit and shows a counter near it.

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

- [#69](https://github.com/AshikNesin/tiny-agents/pull/69) [`542bcba`](https://github.com/AshikNesin/tiny-agents/commit/542bcbacdf10b0a476f1c5df2dd092ec0126784c) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Routine results in the chat are quiet and per thread (issue [#63](https://github.com/AshikNesin/tiny-agents/issues/63) follow-up).
  
  - A finished run shows as one centered line (name, status, time) instead of a full card; runs that finish back to back fold into one line ("ran 4× · 1 failed · last 09:00"), and clicking it shows each run's output and error.
  - `Bot.chatStartedAt` (both engines, migration `bot_chat_started_at`): set when a bot is created and on "New chat". Only runs that finished after it show, so a new chat starts clean; earlier results stay on the Routines page. Existing bots start at the migration.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`ba068e8`](https://github.com/AshikNesin/tiny-agents/commit/ba068e893e58334c61a06bcf935b71a1c3fd9f39) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Routines: a one-time routine can no longer be set for a time that has passed.
  The form says "Pick a time in the future" and blocks Create (the date picker
  starts at now), and the API refuses it too, including for routines bots create.
  A one-time routine that has run now reads "Done" instead of "Paused", and its
  toggle can't re-arm it: re-enabling it used to leave it "enabled" with a past
  "Next run" at the top of Upcoming, never firing. Edit it to pick a new time.
  The preview lists a one-time routine's single run instead of the same time
  three times, and a late run says "late by 3h 12m" or "late by 2 days" instead
  of a raw minute count.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`e8b124e`](https://github.com/AshikNesin/tiny-agents/commit/e8b124e110da2bb5f68f82db9ec6692dce3e4a6f) Thanks [@AshikNesin](https://github.com/AshikNesin)! - `SANDBOX_HOST` now defaults to the production VM only in production. On a
  fresh development or test setup it is empty, so the browser runs a local
  headless Chromium instead of failing with `getaddrinfo ENOTFOUND
  tiny-agents-vm`, the terminal shows "not configured", and the live terminal
  e2e specs skip themselves as intended. Production is unchanged: it still
  defaults to `tiny-agents-vm`, and the sandbox, attachments, browser and
  terminal now all read the host the same way.

- [#132](https://github.com/AshikNesin/tiny-agents/pull/132) [`e7cd039`](https://github.com/AshikNesin/tiny-agents/commit/e7cd039d60bc9b9f26939931d691a2958ed308df) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Adds self-improvement: a `self-improve` capability whose `update_instructions` tool lets a bot propose edits to its own system prompt, taking effect from its next message. The tool is `askOnly` (the owner approves every change in chat, with the proposed text on the approval card) and the store adapter refuses writes outside the owner's own turns (routine runs, peer deliveries), the same rule as `remember`. The bot's current instructions render as a prompt section beside the tool. Every applied change (self or manual editor edit) appends a full-snapshot `prompt_revisions` row before the bot row updates, giving append-only, revertable history: the database analog of an instructions file under git.

- [#46](https://github.com/AshikNesin/tiny-agents/pull/46) [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Slim the sidebar to the essentials: Chats, Tasks and Terminal stay in the
  nav; Routines, Skills, Memory and Connections move into the account menu
  beside Settings (the account row reads as selected while one is open), and
  Theme leaves that menu for Settings › Appearance.
  Search is an icon beside the collapse toggle (⌘K / Ctrl+K still works).

- [`f43cb80`](https://github.com/AshikNesin/tiny-agents/commit/f43cb808dafd83f1d6be802c6011b2da77df7efc) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Remove the manual “Forgets after” field from the memory editor. Keep manual additions permanent and preserve automatic expiry on existing memories, including clearing past expiry when restoring a memory.

- [#48](https://github.com/AshikNesin/tiny-agents/pull/48) [`bbf5163`](https://github.com/AshikNesin/tiny-agents/commit/bbf5163dae529c1fd7ee8f79dfd65003c89014fc) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Leaving a skill page with unsaved edits now asks first ("Keep editing" /
  "Discard") for sidebar links, the ⌘K palette and browser back, and closing
  or reloading the tab gets the browser's leave prompt. The app now runs on a
  data router so pages can hold navigation (`LeaveGuard`). Routine run results
  show the reply as plain text instead of raw markdown such as `**`.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`87021e5`](https://github.com/AshikNesin/tiny-agents/commit/87021e51c93be69bd194b54f0f5b4592a479d3a7) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Production now caches the app's fingerprinted files (`/assets/*`) for a year
  instead of downloading every script and stylesheet again on each visit, and a
  request for a build file that does not exist gets a 404 instead of the app's
  HTML with a 200. That HTML used to break tabs left open across a deploy (an
  old chunk came back as HTML), could be cached by the CDN under the asset's
  URL, and hid build problems such as the missing font. A tab that still fails
  to load a chunk after a deploy now reloads itself once to pick up the new
  build.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`60e2f5f`](https://github.com/AshikNesin/tiny-agents/commit/60e2f5f0e8e56633b48687b249978205b1b877c1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Tasks: a long URL or other unbroken text in a task title now wraps inside the
  card instead of running past its edge and getting cut off.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`e9c971b`](https://github.com/AshikNesin/tiny-agents/commit/e9c971bf8a68acefe00fae395ab94e4204cfc396) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Tasks: Upcoming now lists dated tasks soonest first and puts tasks without a
  due date at the bottom under "No date", instead of above real deadlines.
  Quick-add understands a little shorthand: "Call mom tomorrow 5pm !high" adds
  "Call mom" due tomorrow at 5 PM with high priority (today, tonight, tomorrow,
  weekday names, times like 5pm or 17:30, and !high / !medium / !low). A line
  under the box shows what it understood before you add it.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`76a561b`](https://github.com/AshikNesin/tiny-agents/commit/76a561b24e6d65b27f43b37d33652122074cad04) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Terminal: opening the Terminal page no longer waits about 10 seconds for a
  prompt. Every terminal request used to open a fresh SSH connection to the
  sandbox (about 2 seconds each over the tailnet, three of them before the first
  prompt); listing, tickets and attaches now share one pooled connection that
  reconnects on its own and closes after five idle minutes, and getting a ticket
  no longer makes an extra round trip. A channel that stalls retires the shared
  connection so new work goes to a fresh one. The empty pane says "Connecting to
  sandbox…" until the first output arrives.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`b65eb7a`](https://github.com/AshikNesin/tiny-agents/commit/b65eb7a29939b4468793d14fa52f9ec1d21aa1a3) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Toasts now appear at the top of the screen. At the bottom right they covered
  the chat composer's Send/Stop button and swallowed clicks on it for a few
  seconds, most noticeably right after creating a bot. Creating a bot also no
  longer shows a "Bot created" toast: its chat opens instead.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`f4c0411`](https://github.com/AshikNesin/tiny-agents/commit/f4c0411840151a1782caa0fd15429e31d90de939) Thanks [@AshikNesin](https://github.com/AshikNesin)! - A tool's run time no longer includes the time it waited for your approval.
  Opening a page you approved after a minute and a half used to read "117.2s";
  it now reads the tool's own time with the wait beside it, e.g.
  "15.1s · waited 1m 40s for you".

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`e01c3ec`](https://github.com/AshikNesin/tiny-agents/commit/e01c3ec92ca0f8ee76c901987bd54b83caba435e) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Bot names are unique, and an @mention reaches the bot you picked (issue [#80](https://github.com/AshikNesin/tiny-agents/issues/80)).
  
  - Creating or renaming a bot to a name another bot already has is refused with 409 `A bot named "Echo" already exists`. Names compare without case and surrounding spaces, so `"  echo "` counts as `Echo`; a bot can still change the case of its own name. The bot dialog shows the message under the Name field.
  - A mention picked from the @ list goes to that bot, even when older data has two bots with the same name. A typed `@Name` still matches by name; if several bots have that name, the message is held and the composer asks you to pick one from the list.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`0d5e3cd`](https://github.com/AshikNesin/tiny-agents/commit/0d5e3cd0681b73a278d93b42564f8ae284866936) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Sidebar: the unread dot on a bot row is visible again. It was an inline
  `<span>`, so its 8px size was ignored and it rendered as an empty 0×0 box.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`f9e106f`](https://github.com/AshikNesin/tiny-agents/commit/f9e106f6ea7263bdcd7674d239e39dce4fa16b9d) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Attachments: a file over 25 MB is now refused in the composer before it
  uploads ("big.mp4 is 30 MB; files can be up to 25 MB."), and the server
  answers 413 "Files can be up to 25 MB." instead of a 500 that was logged (and
  sent to Sentry) as a server error. When an upload fails, a toast now gives the
  reason, and the failed tile no longer draws "Upload failed" over the file name.

- [#98](https://github.com/AshikNesin/tiny-agents/pull/98) [`40a8092`](https://github.com/AshikNesin/tiny-agents/commit/40a809206e13a8c316b5d823955483fb0033a8eb) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Fix invalid HTML that made React log DOM-nesting errors: the breadcrumbs on the
  skill, connection and connection-tool pages put a separator `<li>` inside a
  breadcrumb `<li>`, and a chat reply with text next to an image put the image
  wrapper `<div>` inside a `<p>`.
- Updated dependencies [[`6eb3213`](https://github.com/AshikNesin/tiny-agents/commit/6eb3213531c944636c0810c0d900a8e7ba3aa0a5), [`7bb89a5`](https://github.com/AshikNesin/tiny-agents/commit/7bb89a5e0074c587192067032a45edf64cd140e0), [`31d338d`](https://github.com/AshikNesin/tiny-agents/commit/31d338d3c702dbf51129b07fd3267d85f17909a4), [`a6a4e79`](https://github.com/AshikNesin/tiny-agents/commit/a6a4e79fded85cb2fa1e7bbd2c3560555ea07ea7), [`666cafd`](https://github.com/AshikNesin/tiny-agents/commit/666cafd7c4ddcd692fd31aa1ef5dd847b842f348), [`998668e`](https://github.com/AshikNesin/tiny-agents/commit/998668e8f9612c282ce193f838bf826eab50c602), [`4285c60`](https://github.com/AshikNesin/tiny-agents/commit/4285c608210820ec2720debb143cac1b9caa09f1), [`28cc58f`](https://github.com/AshikNesin/tiny-agents/commit/28cc58f724801d5afa28b275e7cd5ca4d4a919c1), [`58ad432`](https://github.com/AshikNesin/tiny-agents/commit/58ad4328986aa69ed7281425ceae42ba254e3d46), [`1d8cb7a`](https://github.com/AshikNesin/tiny-agents/commit/1d8cb7acd10802cf1d430eb38829f844c7e5c2cd), [`7147d40`](https://github.com/AshikNesin/tiny-agents/commit/7147d406ca552b24cea73277b38c93170b715aa9), [`e55fe6f`](https://github.com/AshikNesin/tiny-agents/commit/e55fe6f4fbe58704569e5ae5bfce36561e737275), [`8af6c00`](https://github.com/AshikNesin/tiny-agents/commit/8af6c000505b5cc575993db964318ae25f439086), [`98b28d2`](https://github.com/AshikNesin/tiny-agents/commit/98b28d291238d236f4d693f72759bfcd34680637), [`d241660`](https://github.com/AshikNesin/tiny-agents/commit/d241660baa5767d9df7a88c8cbe5b80aa0613061), [`554fe18`](https://github.com/AshikNesin/tiny-agents/commit/554fe18aeeb803ec970a2e0f9065d6dd39f80e8a), [`5bc76f2`](https://github.com/AshikNesin/tiny-agents/commit/5bc76f2e8a00227cc331067a8b4ed825fb1af8bf), [`493336a`](https://github.com/AshikNesin/tiny-agents/commit/493336a4d360cfdb3da04c09cbdb43bef62f9523), [`a8a008d`](https://github.com/AshikNesin/tiny-agents/commit/a8a008d51e84d0df42eb513cb7b492669e37fca2), [`b0e6a13`](https://github.com/AshikNesin/tiny-agents/commit/b0e6a13731c221245673146d37a547c71fb191ed), [`16cfe00`](https://github.com/AshikNesin/tiny-agents/commit/16cfe00b63d9d8ffb29efc4e058d0290dc6e2b40), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`514b6ef`](https://github.com/AshikNesin/tiny-agents/commit/514b6efda40bb2268920402a0f7260e06b6ba3da), [`a3c31c7`](https://github.com/AshikNesin/tiny-agents/commit/a3c31c790262a4747d64e9b3bdbfd4d7e15eb4b1), [`9a2224e`](https://github.com/AshikNesin/tiny-agents/commit/9a2224ecf1bd5a26aa2502365abdfae8ae725794), [`4814aca`](https://github.com/AshikNesin/tiny-agents/commit/4814aca75211052126f2dfdd163f16ebbb6d50f0), [`ceb61ee`](https://github.com/AshikNesin/tiny-agents/commit/ceb61eee088193ec8f487b2f6fecbd729d8a236b), [`601772a`](https://github.com/AshikNesin/tiny-agents/commit/601772a74aff3dc4542b763f9faf43e62835479f), [`2cb97ff`](https://github.com/AshikNesin/tiny-agents/commit/2cb97fffd97ace0cd763e6c3984289dc0d2420aa), [`f1e3914`](https://github.com/AshikNesin/tiny-agents/commit/f1e39146a6cd72b104b41a905080fea52a9a340c), [`16cfe00`](https://github.com/AshikNesin/tiny-agents/commit/16cfe00b63d9d8ffb29efc4e058d0290dc6e2b40), [`16cfe00`](https://github.com/AshikNesin/tiny-agents/commit/16cfe00b63d9d8ffb29efc4e058d0290dc6e2b40), [`2ab32b4`](https://github.com/AshikNesin/tiny-agents/commit/2ab32b4820df9871a27f9312b8f29c3bad5f8e3d), [`2ab32b4`](https://github.com/AshikNesin/tiny-agents/commit/2ab32b4820df9871a27f9312b8f29c3bad5f8e3d), [`5c3262f`](https://github.com/AshikNesin/tiny-agents/commit/5c3262fc24846a01c669e93af9fe9cdeceddd680), [`2e60f7b`](https://github.com/AshikNesin/tiny-agents/commit/2e60f7ba3404b8bff5985ccf3a9828d7393c53c5), [`9e6b629`](https://github.com/AshikNesin/tiny-agents/commit/9e6b629b9146186b3d3b08cc65f3a78c32943389), [`a111ade`](https://github.com/AshikNesin/tiny-agents/commit/a111ade11c5551a018328c218b34f4807f0c3b70), [`8dd01ad`](https://github.com/AshikNesin/tiny-agents/commit/8dd01ad7f48d3326a124eb838f0b9061797f31c7), [`046443a`](https://github.com/AshikNesin/tiny-agents/commit/046443a45d56e86449b241eea4a9c924a2b5ee22), [`0826ecb`](https://github.com/AshikNesin/tiny-agents/commit/0826ecbc3ea7c3e68fa93bb00648688d53cb0b81), [`046443a`](https://github.com/AshikNesin/tiny-agents/commit/046443a45d56e86449b241eea4a9c924a2b5ee22), [`81a32ec`](https://github.com/AshikNesin/tiny-agents/commit/81a32ec6e152e8aea235fedf6b86146dd43068cf), [`d3edec4`](https://github.com/AshikNesin/tiny-agents/commit/d3edec495049d15abdd18b5c7832224ef4a25e93), [`4b8a557`](https://github.com/AshikNesin/tiny-agents/commit/4b8a557bb85aef95dcbf4e2158f2fa3c601da23f), [`c9fa54e`](https://github.com/AshikNesin/tiny-agents/commit/c9fa54e1d052a234608dcded83decb5fe65bbf5e), [`aa4adf8`](https://github.com/AshikNesin/tiny-agents/commit/aa4adf8db074e8398c5b3693759c5ed450ca0626), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`554fe18`](https://github.com/AshikNesin/tiny-agents/commit/554fe18aeeb803ec970a2e0f9065d6dd39f80e8a), [`bbf5163`](https://github.com/AshikNesin/tiny-agents/commit/bbf5163dae529c1fd7ee8f79dfd65003c89014fc), [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3), [`85971f0`](https://github.com/AshikNesin/tiny-agents/commit/85971f05a93f87dc801a9a71237729c9e49d3a61), [`371f766`](https://github.com/AshikNesin/tiny-agents/commit/371f766487b4800ad9c228326012f471822ebf94), [`1592b0d`](https://github.com/AshikNesin/tiny-agents/commit/1592b0de69f7afdc8bb2937c4d97746d5dd6509d), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`fea622e`](https://github.com/AshikNesin/tiny-agents/commit/fea622eaa18d350a1c0c5e3cfccda3960810d1fa), [`3834e7b`](https://github.com/AshikNesin/tiny-agents/commit/3834e7b5566ea04dffa7f3e15f045306829a97c4), [`db1c8aa`](https://github.com/AshikNesin/tiny-agents/commit/db1c8aa284e424ba3c92068466a87f0439af7fa2), [`ddedf15`](https://github.com/AshikNesin/tiny-agents/commit/ddedf1508f5cf1557b45ce75eebeaf274365f817), [`c1572ce`](https://github.com/AshikNesin/tiny-agents/commit/c1572cec3d397bf650cf5407fa8be8d2d689c828), [`1b4cf57`](https://github.com/AshikNesin/tiny-agents/commit/1b4cf574edbd0a20f4cddae400b32f7419c617f3), [`e7cd039`](https://github.com/AshikNesin/tiny-agents/commit/e7cd039d60bc9b9f26939931d691a2958ed308df), [`786e799`](https://github.com/AshikNesin/tiny-agents/commit/786e799d53e2a6e58f053fb49d6c228e260eb27c), [`3944039`](https://github.com/AshikNesin/tiny-agents/commit/39440393d04314b7cd9e8afbf5f8fb72105d0a2d), [`d419bdf`](https://github.com/AshikNesin/tiny-agents/commit/d419bdf388ac5b583b7329a3ef88cb3e7f1f321a), [`c760f77`](https://github.com/AshikNesin/tiny-agents/commit/c760f77e0919d0b7fccd44a68894889560833a7b), [`92c2060`](https://github.com/AshikNesin/tiny-agents/commit/92c2060bfbdfa1969764ae80372f899251e08a52), [`9f88d8f`](https://github.com/AshikNesin/tiny-agents/commit/9f88d8f5837bcffa1440bb57511d1e4c9b9f0690), [`4c9ad9c`](https://github.com/AshikNesin/tiny-agents/commit/4c9ad9c7166a4b204c15843064f6513e1e985f38), [`76a561b`](https://github.com/AshikNesin/tiny-agents/commit/76a561b24e6d65b27f43b37d33652122074cad04), [`1aba64a`](https://github.com/AshikNesin/tiny-agents/commit/1aba64adc300564792ce34e7a65d067d02ee9148), [`f4c0411`](https://github.com/AshikNesin/tiny-agents/commit/f4c0411840151a1782caa0fd15429e31d90de939), [`037e1aa`](https://github.com/AshikNesin/tiny-agents/commit/037e1aaa6a33c555ee83be692bcd93103c012384), [`f68af60`](https://github.com/AshikNesin/tiny-agents/commit/f68af60207a704ffc54b797ddb06b19f3403c842), [`a6a4e79`](https://github.com/AshikNesin/tiny-agents/commit/a6a4e79fded85cb2fa1e7bbd2c3560555ea07ea7), [`9029da7`](https://github.com/AshikNesin/tiny-agents/commit/9029da718a59d989f03a27e9a581d81244cf6698), [`1d6353a`](https://github.com/AshikNesin/tiny-agents/commit/1d6353a8b48b209d9d540750cee36b961029830a)]:
  - @tiny-agents/agent@0.2.0
  - @groot/shell@1.2.0
  - @groot/core@1.1.0
  - @groot/ui@0.9.0
  - @groot/jobs@1.1.0

## 0.2.23

### Patch Changes

- Updated dependencies [[`297f957`](https://github.com/AshikNesin/groot/commit/297f957bc0fcda60dcb63deb770bda7860e92b7e), [`73677b0`](https://github.com/AshikNesin/groot/commit/73677b01da2163aca4d8c78c35f637b124a58b5e), [`09fea32`](https://github.com/AshikNesin/groot/commit/09fea322f9fa0c12397d8dccbc88638612dd99ca)]:
  - @groot/jobs@0.9.3
  - @groot/shell@0.10.3
  - @groot/ui@0.7.1
  - @groot/core@0.10.2

## 0.2.22

### Patch Changes

- Updated dependencies [[`960a9c1`](https://github.com/AshikNesin/groot/commit/960a9c15e059e49b2edcfb837875c9efc399190d), [`e95a091`](https://github.com/AshikNesin/groot/commit/e95a09100a8459eab096df4d414ba081d8454112), [`81cfc6d`](https://github.com/AshikNesin/groot/commit/81cfc6d9797f3d51d6b79555ac933d1eebacb83a), [`bb4e94d`](https://github.com/AshikNesin/groot/commit/bb4e94d544ce23d4e8fe35411ff2fcc72bec4c3c), [`9477a61`](https://github.com/AshikNesin/groot/commit/9477a61b24c2f2d722ceb476cba652c34af96acb)]:
  - @groot/ui@0.7.0
  - @groot/shell@0.10.2
  - @groot/jobs@0.9.2
  - @groot/core@0.10.1

## 0.2.21

### Patch Changes

- Updated dependencies [[`9e5602a`](https://github.com/AshikNesin/groot/commit/9e5602a68d11df36357165df982f71cb8d6c2a79)]:
  - @groot/core@0.10.0
  - @groot/jobs@0.9.1
  - @groot/ui@0.6.0
  - @groot/shell@0.10.1

## 0.2.20

### Patch Changes

- Updated dependencies [[`18e3200`](https://github.com/AshikNesin/groot/commit/18e3200e3a34db550672c49aa2c5683a4f261b11), [`18e3200`](https://github.com/AshikNesin/groot/commit/18e3200e3a34db550672c49aa2c5683a4f261b11), [`18e3200`](https://github.com/AshikNesin/groot/commit/18e3200e3a34db550672c49aa2c5683a4f261b11), [`18e3200`](https://github.com/AshikNesin/groot/commit/18e3200e3a34db550672c49aa2c5683a4f261b11), [`18e3200`](https://github.com/AshikNesin/groot/commit/18e3200e3a34db550672c49aa2c5683a4f261b11)]:
  - @groot/core@0.9.0
  - @groot/jobs@0.9.0
  - @groot/shell@0.10.0
  - @groot/ui@0.5.0

## 0.2.19

### Patch Changes

- Updated dependencies [[`cc632b9`](https://github.com/AshikNesin/groot/commit/cc632b982912b5d9261bfd268813ed25a30ef395), [`19a086c`](https://github.com/AshikNesin/groot/commit/19a086c832c9a009ecef2ff3eaf905f24d54f2a7), [`d03042b`](https://github.com/AshikNesin/groot/commit/d03042b6798461138fccb5d1881b2f9e80521153)]:
  - @groot/core@0.8.1
  - @groot/jobs@0.8.3
  - @groot/shell@0.9.1

## 0.2.18

### Patch Changes

- Updated dependencies [[`399ee35`](https://github.com/AshikNesin/groot/commit/399ee35d36a4bae5fcd3df68b481170d6f68da53), [`399ee35`](https://github.com/AshikNesin/groot/commit/399ee35d36a4bae5fcd3df68b481170d6f68da53), [`399ee35`](https://github.com/AshikNesin/groot/commit/399ee35d36a4bae5fcd3df68b481170d6f68da53)]:
  - @groot/jobs@0.8.2
  - @groot/shell@0.9.0
  - @groot/ui@0.4.0

## 0.2.17

### Patch Changes

- Updated dependencies [[`c097350`](https://github.com/AshikNesin/groot/commit/c0973502ae2e731094876e05dcfc9b3db6b3ccfc), [`c097350`](https://github.com/AshikNesin/groot/commit/c0973502ae2e731094876e05dcfc9b3db6b3ccfc), [`c097350`](https://github.com/AshikNesin/groot/commit/c0973502ae2e731094876e05dcfc9b3db6b3ccfc)]:
  - @groot/core@0.8.0
  - @groot/shell@0.8.0
  - @groot/jobs@0.8.1

## 0.2.16

### Patch Changes

- Updated dependencies [[`e64cc32`](https://github.com/AshikNesin/groot/commit/e64cc32d34a41936bba0b00f7758059eb2d83723), [`02a221b`](https://github.com/AshikNesin/groot/commit/02a221b8f8a83ba095a12dc986090fce897af10f)]:
  - @groot/jobs@0.8.0

## 0.2.15

### Patch Changes

- Updated dependencies [[`0051546`](https://github.com/AshikNesin/groot/commit/005154619ee39ca399a96bcea02ba0fbbcfd3e91), [`5efcd19`](https://github.com/AshikNesin/groot/commit/5efcd19c4d87de3afc47c32d8aae8fe2bd20e525)]:
  - @groot/shell@0.7.0
  - @groot/jobs@0.7.4

## 0.2.14

### Patch Changes

- Updated dependencies [[`90c30e0`](https://github.com/AshikNesin/groot/commit/90c30e02b09c3e355bd8a0aa0f431006dd55431b)]:
  - @groot/ui@0.3.0
  - @groot/jobs@0.7.3
  - @groot/shell@0.6.2

## 0.2.13

### Patch Changes

- Updated dependencies [[`011c6d5`](https://github.com/AshikNesin/groot/commit/011c6d5595ea9e4fff8911f56e497e497aecb380)]:
  - @groot/jobs@0.7.2
  - @groot/ui@0.2.2
  - @groot/shell@0.6.1

## 0.2.12

### Patch Changes

- Updated dependencies [[`b9906ec`](https://github.com/AshikNesin/groot/commit/b9906ec95ba2702d5f7f3176333e65be30a2ff8f)]:
  - @groot/shell@0.6.0
  - @groot/jobs@0.7.1

## 0.2.11

### Patch Changes

- [#92](https://github.com/AshikNesin/groot/pull/92) [`4b8c990`](https://github.com/AshikNesin/groot/commit/4b8c990b97d513981fd4950bf17ac09a5550eb78) Thanks [@exe-dev-github-integration](https://github.com/apps/exe-dev-github-integration)! - Model honker job-queue tables in the SQLite Prisma schema to prevent migration drift

  The honker SQLite job queue (@russellthehippo/honker-node) creates its own
  tables (`_honker_live`, `_honker_dead`, `_honker_locks`,
  `_honker_notifications`, `_honker_rate_limits`, `_honker_results`,
  `_honker_scheduler_tasks`, `_honker_stream`, `_honker_stream_consumers`) at
  runtime inside the app's SQLite file. Because Prisma's migration history didn't
  know about them, `prisma migrate dev` detected drift and wanted to drop all nine
  tables: breaking migration creation against any database honker had touched.

  This mirrors how the `keyv` table is already handled: the tables are declared in
  a new migration (`20260316000000_honker_tables`, guarded with
  `IF NOT EXISTS` so it's a no-op when honker already bootstrapped them) and
  added as `@@ignore`-d models in `schema.sqlite.prisma` so Prisma neither owns
  nor generates DDL for them. Defaults like `created_at DEFAULT (unixepoch())`
  are expressed via `@default(dbgenerated(...))`, and index names are pinned with
  `@@index(..., map: ...)` so drift detection stays quiet. The three partial
  (`WHERE`-predicate) indexes honker uses on `_honker_live` aren't expressible in
  Prisma syntax and live only in the migration SQL.

  - Verified end-to-end: `prisma migrate dev --create-only` now emits an empty
    migration (zero drift) after honker initializes its tables.
  - No postgres migration needed: postgres uses pg-boss, which keeps its tables
    in a separate schema and never drifts.
  - Updated the schema-parity test to ignore `@@ignore`-d infrastructure models,
    since honker's tables are SQLite-only and intentionally absent from the
    postgres schema.

## 0.2.10

### Patch Changes

- Updated dependencies [[`a9b3825`](https://github.com/AshikNesin/groot/commit/a9b3825a930988d6fcbe9e7f0e53cc8fce5b470e)]:
  - @groot/jobs@0.7.0

## 0.2.9

### Patch Changes

- [`b0a391b`](https://github.com/AshikNesin/groot/commit/b0a391b85274ab8cf2f6837b8dda4dadf6f716a1) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Rename `*.validation.ts` to `*.schema.ts`

  These files contain only Zod schemas, not validation logic, so the
  naming was misleading. Renamed `auth`, `passkey`, `app-settings`,
  `storage`, and `todo` validation files to `*.schema.ts` and updated
  all imports across `@groot/core`, `@groot/web`, the docs, and
  `AGENTS.md`. This is a pure rename: no behavior change.

- Updated dependencies [[`b0a391b`](https://github.com/AshikNesin/groot/commit/b0a391b85274ab8cf2f6837b8dda4dadf6f716a1), [`b0a391b`](https://github.com/AshikNesin/groot/commit/b0a391b85274ab8cf2f6837b8dda4dadf6f716a1), [`b0a391b`](https://github.com/AshikNesin/groot/commit/b0a391b85274ab8cf2f6837b8dda4dadf6f716a1), [`b0a391b`](https://github.com/AshikNesin/groot/commit/b0a391b85274ab8cf2f6837b8dda4dadf6f716a1)]:
  - @groot/ui@0.2.1
  - @groot/jobs@0.6.2
  - @groot/shell@0.5.0
  - @groot/core@0.7.1

## 0.2.8

### Patch Changes

- Updated dependencies [[`986c902`](https://github.com/AshikNesin/groot/commit/986c9024f0f5a106a4a8822b96605c8ef9eee225)]:
  - @groot/jobs@0.6.1

## 0.2.7

### Patch Changes

- Updated dependencies [[`e0d78f5`](https://github.com/AshikNesin/groot/commit/e0d78f5d17c27df512cd53ec20277ffdc9cf19bb)]:
  - @groot/core@0.7.0
  - @groot/jobs@0.6.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`40eb1ec`](https://github.com/AshikNesin/groot/commit/40eb1ece15b0b3c299b32f12763f2c7be4ff25d0), [`40eb1ec`](https://github.com/AshikNesin/groot/commit/40eb1ece15b0b3c299b32f12763f2c7be4ff25d0), [`1e85141`](https://github.com/AshikNesin/groot/commit/1e851410f1b5cdce9a6bcafd269da4f091c99245), [`225280b`](https://github.com/AshikNesin/groot/commit/225280b0899784e6fd92a363adb141dc7647bd24)]:
  - @groot/core@0.6.1
  - @groot/jobs@0.5.2
  - @groot/shell@0.4.0

## 0.2.5

### Patch Changes

- Updated dependencies [[`86c1657`](https://github.com/AshikNesin/groot/commit/86c165721799f81f001ea8f3c986ffc984551b4e)]:
  - @groot/core@0.6.0
  - @groot/jobs@0.5.1

## 0.2.4

### Patch Changes

- Updated dependencies [[`0c47508`](https://github.com/AshikNesin/groot/commit/0c47508c31623b46f051257048c19f7c86c89e2b)]:
  - @groot/core@0.5.0
  - @groot/jobs@0.5.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`5f9eddd`](https://github.com/AshikNesin/groot/commit/5f9eddd7bba05222c378578a7d0900dac53d52a2)]:
  - @groot/core@0.4.1
  - @groot/shell@0.3.1
  - @groot/jobs@0.4.1

## 0.2.2

### Patch Changes

- Updated dependencies [[`83b3a6f`](https://github.com/AshikNesin/groot/commit/83b3a6f1ce34a28299b00f18645faabf3e9569a8)]:
  - @groot/core@0.4.0
  - @groot/ui@0.2.0
  - @groot/shell@0.3.0
  - @groot/jobs@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`ae54b49`](https://github.com/AshikNesin/groot/commit/ae54b4920f39b2dbd9432298855210cb4752cd57)]:
  - @groot/core@0.3.0
  - @groot/shell@0.2.0
  - @groot/jobs@0.3.0
  - @groot/ui@0.1.0

## 0.2.0

### Minor Changes

- [`07de4af`](https://github.com/AshikNesin/groot/commit/07de4afce92948ac8a657284548d21fb7a670910) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Extract logger into a dedicated `@groot/core/logger` package

  The Pino logger module moves out of `@groot/core/core/logger/` into its own
  flat `@groot/core/logger` package (mirrors `@groot/core/database` as a leaf). This removes
  the `@groot/jobs` → `@groot/core` reach-through for logger exports and gives
  foundational infrastructure its own package boundary.

  **Breaking: migration required for downstream repos:**

  - All `@groot/core/core/logger` imports must move to `@groot/core/logger`. Affected
    surfaces: server middlewares, kv store, shared services, the jobs backend,
    the app bootstrap, and tests that `vi.mock` the logger.
  - The logger no longer reads `env`/`config` eagerly. The server bootstrap must
    call `configureLogger({ level, service, nodeEnv })` once before request
    handling: `apps/web/src/server/index.ts` now does this as the first statement
    in `main()`:
    ```ts
    import { configureLogger } from "@groot/core/logger";
    configureLogger({
      level: config.logging.level,
      service: config.app.name,
      nodeEnv: env.NODE_ENV,
    });
    ```
    This preserves the `config.logging.level` / `config.app.name` YAML knobs.
  - `loggerConfig` / `logLevel` are now live bindings updated by `configureLogger`
    (read them at runtime, not import time). `isDevelopment` reads `process.env.NODE_ENV`
    directly (equivalent to the previous `env.NODE_ENV`).

  Notes:

  - `@groot/core/logger` is a leaf (deps: `pino`, `pino-pretty`, `dayjs`; `@types/express`/`@types/node` dev). No `@groot/*` deps.
  - `@groot/core`, `@groot/jobs`, and `apps/web` now declare `@groot/core/logger` as a workspace dependency.
  - `@groot/core` no longer contains the logger module; the `packages/core/src/logger/` directory is removed.
  - Configured via the esbuild/vitest/tsconfig `@groot/core/logger` alias.

### Patch Changes

- Updated dependencies [[`07de4af`](https://github.com/AshikNesin/groot/commit/07de4afce92948ac8a657284548d21fb7a670910)]:
  - @groot/core@0.2.0
  - @groot/jobs@0.2.0
  - @groot/core/logger@0.1.0

## 0.1.0

### Minor Changes

- [#60](https://github.com/AshikNesin/groot/pull/60) [`0473401`](https://github.com/AshikNesin/groot/commit/0473401aacc5ccd4e67e8def92e98b30ecd72a9a) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Extract all jobs code into a dedicated `@groot/jobs` package

  The entire jobs vertical: pg-boss backend infrastructure, HTTP admin API,
  job logger, the dashboard UI, client types, and API methods, now lives in a
  single `@groot/jobs` package with two flat entry points:

  - `@groot/jobs/server/*`: pg-boss queue/worker/queries, routes, job logger
  - `@groot/jobs/client/*`: dashboard UI, `jobsApi`, types

  Business-specific handlers (`todo.jobs.ts`) and bootstrap wiring stay in
  `apps/web/`. This consolidates jobs code that was previously spread across
  `@groot/core` (`core/job`, `shared/jobs`, `core/logger`), `@groot/shell`
  (`types/jobs`, apiClient methods), and `apps/web` (dashboard UI).

  **Breaking: migration required for downstream repos:**

  - `createJobLogger` / `JobLogStream` / `createJobLogStream` moved from
    `@groot/core/core/logger` → `@groot/jobs/server/logger`. The
    `@groot/core/core/logger` re-exports are removed.
  - The 17 job methods were removed from `apiClient` (`@groot/shell/lib/api`).
    Use `jobsApi` from `@groot/jobs/client` instead.
  - `JobName` changed from an enum (with hardcoded `TODO_*` values) to
    `type JobName = string`. App-specific job names live with their handlers.
  - Server-side imports of job infra must move from
    `@groot/core/core/job/*` and `@groot/core/shared/jobs/*` to
    `@groot/jobs/server/*` (use explicit subpaths like `/worker`, `/logger`,
    `/routes` for the server bundle).
  - The jobs dashboard UI moved from `apps/web/src/client/pages/jobs/` to
    `@groot/jobs/client`. Import pages via `@groot/jobs/client`.

  The `database → logger → job-stream → database` module cycle is resolved as
  a side effect (job-stream left `@groot/core/core/logger`). `pg-boss` is no
  longer a dependency of `@groot/core` (it now lives in `@groot/jobs`).

### Patch Changes

- Updated dependencies [[`0473401`](https://github.com/AshikNesin/groot/commit/0473401aacc5ccd4e67e8def92e98b30ecd72a9a)]:
  - @groot/core@0.1.0
  - @groot/shell@0.1.0
  - @groot/jobs@0.1.0
