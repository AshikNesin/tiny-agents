# tiny-agents

A messenger where every contact is an AI bot. Each bot is a row in app.db
paired with a durable conversation in agent.db (pi-durable).

## Language

**Bot**:
A contact the owner chats with: persona, model, tool permissions and links, stored as the `Bot` row.
_Avoid_: agent, assistant, contact

**Bot conversation**:
The durable pi-durable conversation a bot runs on, linked by `Bot.conversationId`. It runs on the config from its last configure, so it is reconciled from the row before every submit. It holds the transcript on either engine: pi's entries, or the Claude plan transcript.
_Avoid_: thread, session, chat (for the durable side)

**Claude plan transcript**:
A Claude plan conversation's messages as entries of its bot conversation (ADR 0018): `claude.user` for each admitted message (deduplicated by request id in the admitting commit), `claude.assistant` for each turn's reply (written when a tool call finishes and when the turn ends; the newest per turn wins) and `claude.withdrawn` for queued messages withdrawn before their turn. None carries model context, so pi neither reads nor shows them. `packages/agent/src/engines/claude-code/transcript.ts` owns their shapes and the chat they project to; the old `<agent.db>.claude.json` is imported into them once.
_Avoid_: Claude session (that is Claude Code's own, which the worker resumes), claude.json

**Reconcile**:
Re-apply a bot's row (model, persona, permissions, toolkits, connections) to its bot conversation. Only `bots.conversation.ts` does this.
_Avoid_: reconfigure, sync

**Delivery**:
A message put in front of a bot from somewhere other than its own chat: an owner @mention or a bot-to-bot message. Each is a `bot_messages` row with an idempotent request id, pinned to the target conversation it was submitted to, and answered with that request's Finished reply, relayed into the asking bot's chat. `bots.delivery.ts` owns all of it.
_Avoid_: dispatch, forward

**Finished reply**:
What a submission's turn came to once its conversation is no longer busy: the turn's last message with text or an error, plus every tool refused in the turn and the newest blocked reason. Found by the submission's request id (`finishedReplyTo`), never by time. Deliveries and routine runs are answered only by Finished replies.
_Avoid_: last message, answer

**Tool-call row**:
A tool call's row in the chat (`tool-call-row.ts`): status, output, timing, the approval and any Owner wait's card, taken from the call's finished result or its live details. Both engines project through it; callers never re-derive a row.
_Avoid_: tool view, tool card (a card is one Owner wait's part of the row)

**Turn**:
Everything from one user message up to the next: the assistant messages (often several, one per tool round) that answer it.
_Avoid_: exchange, round (a turn has several tool rounds)

**Armed state**:
Whether a routine will fire, and when: enabled with exactly one queued routine-fire job for its next run (`pendingJobId`, `nextRunAt`), plus its blocked-run count, the app's paused reason and its own conversation. `routines.arming.ts` owns every change (create, arm, disarm, advance, record blocked, clear streak, claim conversation, move to bot, remove), each one compare-and-set write that cancels the job it replaces.
_Avoid_: schedule (that is the routine's cron/slot rule), enabled (one column of it)

**Routine run**:
One firing of a routine at one slot: a `routine_runs` row that is missed, failed, or awaiting its Finished reply in the routine's own conversation, then succeeded, blocked or failed. `routines.runs.ts` writes every move of the routine-run machine (`apps/web/src/shared/machines/routine-run.ts`) and the card and push that follow.
_Avoid_: job, execution

**Bot chat**:
The conversation a bot is on now, as the owner acts on it (`openBotChat`, `bots.chat.ts`): the bot looked up once, its conversation ref, and the chat actions, with Owner-wait errors mapped to HTTP in one table.
_Avoid_: chat handle, session

**Bot toolkits**:
The capability ids a bot's conversation selects (`botToolkits`, `bot-toolkits.ts`): every built-in toolkit (ADR 0004), vision when its model cannot see images, one `mcp:<slug>` per linked connection, and tool search while one of them has more tools on than the defer threshold. Only `bot-toolkits.ts` decides them; Reconcile applies them.
_Avoid_: toolset, capabilities (for harnesses that word means something else)

**Harness**:
A coding agent tiny-agents drives but does not implement — Shelley, Claude Code — plugged into the Code page through one adapter contract (`HarnessInstance`, `packages/code`). An instance is one configured harness (`shelley`, `claude-code`); a thread is addressed `<instance>:<native id>`. The harness owns the transcript; tiny-agents keeps only the thread index (ADR 0011).
_Avoid_: provider (model providers), backend, engine (bot engines)

**Capability**:
What a harness really does (steer, approvals, diffs, …), declared by its driver. The Code page shows a control only when the thread's harness has its capability; it never fakes one.
_Avoid_: feature flag

**Thread feed**:
What one harness thread's watchers are sent, and when (`ThreadFeed`, `@tiny-agents/code/server`). A driver tells it the thread as it is now (a snapshot, the full row list, the streaming text, a state change); the feed sends each watcher its snapshot first, then only rows that changed for it, re-sends the streaming text after a snapshot, and keeps one failing watcher from stopping the others. `threadEventProblems` in `@tiny-agents/code/testing` checks any driver's watch against the same rules.
_Avoid_: watcher (the app's hand-off `code.watcher.ts`), tracker, stream (Shelley's `stream2`)

**Turn outcome**:
What a harness thread's newest turn came to (`turnOutcome`, `@tiny-agents/code/server`): its last answer or error, chat-sized, and when the harness last wrote to it. A message after the turn ended starts a new turn, with no answer until the harness replies; a Steer belongs to the turn it went into. Both `outcome()` and `turn_ended` carry it, and `turnOutcomeProblems` checks a driver against it.
_Avoid_: final text, last answer

**Shelley**:
The owner's coding agent on another machine ([boldsoftware/shelley](https://github.com/boldsoftware/shelley)), one harness of the Code page and the default for bot hand-offs. tiny-agents is a client of its official API (ADR 0009, ADR 0011).
_Avoid_: coder, coding bot

**Claude Code harness**:
Claude Code on the sandbox, driven through the Claude worker's coding mode (ADR 0012): built-in tools on, a plain working directory, `acceptEdits` by default. Not the Claude plan bot engine, which keeps Claude Code's tools off (ADR 0008).
_Avoid_: Claude engine (that is the bot engine)

**Hand-off**:
A bot giving coding work to a harness with `code_start` (or `shelley_start`): a `code_handoffs` row whose finish is delivered once into the bot's chat as a reply from that harness.
_Avoid_: job, delegation

**Project**:
A GitHub repository bound to a checkout on the sandbox, with a base branch, defaults, scripts and Auto-fix rules (`code_projects`, ADR 0021). A thread started in a project gets its own worktree on a new branch; a thread without one works in any directory, as before.
_Avoid_: repo (the GitHub side only), workspace

**PR link**:
A pull request recorded against a Code thread (`code_pull_requests`): made on Publish, by Link pull request, or by matching the thread's branch. A thread may have several over time, at most one open; a PR belongs to one thread. GitHub is the source of truth and the row its cache.
_Avoid_: PR binding, subscription

**Pass**:
One Auto-fix run on a linked PR (ADR 0023): claimed for one state of the PR (its head sha and items), sent to the thread as a fix request, and finished when the turn ends, when the app checks, pushes and answers the reviewers.
_Avoid_: fix run, attempt (a conflict's "attempts" are passes)

**Steer**:
A message sent to a harness while its turn runs: it goes into that turn. Queue holds a message for when the turn ends instead.
_Avoid_: interrupt (Stop interrupts)

**Vault use**:
One resolution of a vault item's value into a sink, after policy, the owner's approval and a re-check of the target. `VaultUse` names the item, the sink tool, the target and its kind (origin, host, command, connection, window, provider); the audit row records what the sink did, never what was meant. `vault.service.ts` owns the policy and the audit, and `useItem`, `resolveConnectionSecret` and `resolveProviderSecret` share one path through it; in the agent package `useFromSink` (one item) and `useAllFromSink` (several, for a command's environment), planned by `vaultGatePlan`, are the one sequence every sink follows.
_Avoid_: fill, lookup, secret access

**Sink**:
The tool that receives a vault value: a browser field, a request header, a confined command's environment, an MCP connection's header, a model provider's requests. A sink declares its target kind; it never sees policy. A sink whose target moved (a page left its origin, a window lost focus) throws `VaultTargetMovedError`.
_Avoid_: consumer, client

**App credential**:
A vault item with audience `app`: a secret the server uses itself, such as a model provider account's key or Code's GitHub token. Bots never list or use it; only its sink (`provider`, `github`) resolves it, for a host the item lists. Shown on the Vault page under "Used by the app" and changed where it is used.
_Avoid_: system secret, server key

**Settled**:
A conversation whose reply finished and went idle. Settling resets the sender's per-turn budget, then answers its Deliveries, resolves its awaiting routine runs, updates the bot list, pushes a failed or long reply to the owner and arms memory capture, in that order, from one read of the transcript, one lookup of who is behind the conversation and one record of when the reply started. `startSettledPipeline` (`bots.settled.ts`) builds every step from the opened runtime, subscribes once, then runs each step's boot sweep. Nothing else listens for idle.
_Avoid_: done, finished (for the conversation)

**Side-call**:
A one-shot model call the app makes off the reply path: memory capture, Past chat titles. `createSideCaller(runtime).complete` (`side-call.ts`) runs on the call's Model role (`memory_capture`, `chat_title`), aborts it at its deadline, and turns any failure into no answer, logged. Callers take it as a port; faux mode has none, so it makes no side-calls.
_Avoid_: background call, LLM call

**Model catalog**:
A projection of the owner's Provider accounts, model rows and Model roles (`ModelCatalog`, `packages/models/src/model-catalog.ts`, `runtime.catalog`): what each model row is, whether it can run now and why not, its Model route, the model a role resolves to, and the accounts' status. A model is named by its row id, so there is no id grammar.
_Avoid_: model list, model registry (that is pi-ai's, which the catalog reads)

**Provider account**:
One way of reaching models, owned by the owner (`providers` row): a Provider kind, an endpoint, an App credential and a name. Its row id is its pi-ai provider id, so renaming it changes no stored reference.
_Avoid_: provider (alone: ambiguous with pi-ai's), integration

**Provider kind**:
What a Provider account speaks (`PROVIDER_KINDS`, `packages/models/src/kinds.ts`): `anthropic`, `openai-chat`, `openai-responses`, `gemini`, `cloudflare-ai-gateway`, `claude-plan` or `faux`. It fixes the wire API, how the key is sent, the defaults and the engine.
_Avoid_: provider type

**Gateway custom provider**:
A provider configured in Cloudflare AI Gateway itself (BYOK custom provider), listed on the gateway Provider account by its slug and base path. Its models are the account's rows named `<slug>/<model>`, served from the provider's own gateway URL on the gateway's token.
_Avoid_: custom model, BYOK provider

**Gateway route**:
An `openai-chat` Provider account that goes through a `cloudflare-ai-gateway` account (`viaProviderId`) to one of the gateway's BYOK upstreams, on the gateway's token.
_Avoid_: custom provider

**Model role**:
A named slot a feature reads its model from (`model_roles`): `bot_default`, `memory_capture`, `chat_title`, `vision`, `classifier`. Unset, each has a documented fallback (`ModelCatalog.forRole`).
_Avoid_: default model (say which role), model setting

**Model route**:
What the runtime needs to call a model: `{ engine, providerId, upstreamId }`. Only the Model catalog builds one, and only for a model that can run.
_Avoid_: model ref, parsed id

**Memory ledger**:
One bot's memories and the rules every write follows, whether a memory comes from capture, the `remember` tool or the Memory page: one row per text (a tombstone is never re-added, except by the owner on the Memory page), supersession of the same bot's active memories only, expiry, the active budget, and the capture watermark, each write one transaction (`memoryLedger(botId)`, `memories.ledger.ts`).
_Avoid_: memory store (that is the agent's port), memory service

**Tool gate**:
The one place a bot's tool call is let through, on either engine (`gate.ts`, ADR 0014): the tool's gate plan, its permission, the unattended refusal, YOLO mode, auto-review, the approval Owner wait and result redaction, decided once per call. Each engine hands it the call and the tool's run; answering a waiting call goes through it too.
_Avoid_: approval gate (approvals are one thing it does), pi gate, Claude gate

**YOLO mode**:
A chat's switch (issue #151) under which every tool call that would ask the owner runs without a card, except vault uses and turns another bot or a guest started. Stored as the conversation's `tiny.yolo` document, not on the bot: a New chat starts with it off. The Tool gate reads it on each call, whichever engine runs the chat, and records such calls as `approval: "yolo"`.
_Avoid_: auto-approve (that is auto-review's), trust mode

**Owner wait**:
A tool call paused until the owner answers: an approval (`approvals.ts`, asked by the Tool gate), a Question (`toolkits/questions.ts`) or a credential request (`credentials.ts`). Each kind owns its durable document, the card details it writes and the parser the transcript reads them with, the host-side "is this task really waiting on me" check, and the one unattended refusal that marks the call `refused`. The runtime and transcript call in; they never re-derive the shapes.
_Avoid_: pending approval (for the family), interrupt, prompt

**Browser session**:
One live browser per profile, owned by the session manager (`packages/sandbox/src/browser-sessions.ts`): open, peek (never launches), the driver flag (owner or bot), the idle sweep, close (which cancels an open still in flight). The toolkit, the vault sinks and the app's browser routes all hold the same manager instance; nothing reads a module global.
_Avoid_: tab (a session has tabs), browser instance

**Computer**:
A bot's desktop (issue #108): XFCE on the sandbox VM, one per browser profile, which the bot sees with screenshots and drives with clicks, keys and typing (`computer_*` tools). Not the owner's machine, and not the sandbox's shell, which stays `run_command`.
_Avoid_: VM (the VM hosts several desktops and the shell), workstation

**Desktop**:
One live computer: an X display served by Xtigervnc with an XFCE session on it, at a fixed size, owned by the computer session manager (`packages/sandbox/src/computer-sessions.ts`) through the `ComputerDesktop` port. It survives an app crash and is reattached by the next launch for its profile.
_Avoid_: screen (a screenshot is of a desktop), display (the X display number)

**Live view**:
The owner's noVNC view of a bot's browser or desktop, in the chat (`BrowserPanel`, `ComputerPanel`) and on the Browser and Computer pages, view-only until the owner takes control. Reached through a one-time ticket and an SSH channel; never a screenshot stream. One client module owns it (`lib/live-view.ts`): the status poll, the driver switch, full screen with the keyboard lock, the connection label and the docked width.
_Avoid_: screencast, preview

**Sandbox connection**:
The app's one SSH connection to the sandbox VM or the local sandbox container (`SandboxConnection`, `packages/sandbox/src/ssh/sandbox-connection.ts`), built once from the endpoint and handed to every user: the sandbox toolkit, attachments, the terminal, the computer, the browser and the Claude worker. It runs execs, ptys, file transfers and forwards as channels on one pooled connection, and owns the host-key pinning, the retry rule, the idle close and the "Cannot reach the sandbox" wording (ADR 0013).
_Avoid_: endpoint (that is only the address), SSH session, transport (a computer or browser transport sits on top of it)

**Worker connection**:
The app's side of one WebSocket to the Claude worker (`WorkerConnection`, `@tiny-agents/claude-worker/client`). The Claude plan bot engine and the Claude Code harness each put their protocol on one (turns and tool results; `coding.*` requests) and never see a socket. It owns the heartbeat and silence close, reconnecting with backoff while finding the worker again on every attempt, the handshake and the `welcome` boot id that tells a worker restart from a dropped socket, a resume cursor per session, requests and their replies, the queue while disconnected, and the wording of a refused token or an HTTP status.
_Avoid_: worker client (that is a protocol layer on it), tunnel (that is the Sandbox connection's forward under it), socket

**Session log**:
A Claude worker session's numbered events (`SessionLog`, `packages/claude-worker/src/session-log.ts`), one per bot session and per coding session: numbered from 1 per worker boot, the last N kept for a resume to replay, the resume result (`known`, `gap`, `firstSeq`, `lastSeq`), and each event handed to its subscribers, the sockets a protocol's handler subscribed.
_Avoid_: replay buffer, fanout, event buffer

**Question**:
A clarifying question a bot asks the owner mid-reply (`ask_owner`). The reply waits until the owner answers or dismisses it; writing in the chat instead dismisses it.
_Avoid_: prompt, form, survey

**Echo**:
The optimistic copy of an owner's send shown until the server confirms it. Its request id is minted once and reused by every retry (an offline send keeps its Echo and goes again once the browser is back), and it is confirmed by that request id. Only an older entry without one is matched by text, and never one created before the Echo. Once the server holds the message while the bot replies, the held item replaces the Echo. The chat session (`lib/chat-session.ts`, `store/chats.ts`) owns its whole life.
_Avoid_: pending message, ghost bubble

**Outbox**:
A chat's owner messages that its transcript does not hold yet, each addressed by its send's request id: Echoes (`sending`, or `offline` until the browser is back), drawn as bubbles at the end of the transcript, and the messages the server holds while the bot replies (`steering` into the running reply, or `queued` for the next one), drawn as rows over the composer that the owner can withdraw. `useChat` returns it with the rest of the chat's view.
_Avoid_: queue (only the held part), pending messages

**Bot list**:
What the sidebar shows for each bot: the row's last-message preview, last activity and read marker, plus what is live (replying, approvals and Questions waiting). `bots.list.ts` builds the entry (its shape is shared with the client, `apps/web/src/shared/bot-list.ts`) and owns the one preview function and the settled step that folds a Finished reply into the row.
_Avoid_: roster (that is the bots toolkit's name for the other bots), sidebar state

**Bot stream**:
One bot's chat, live (`GET /bots/:id/stream`): the newest transcript window as a snapshot and then its changes, the chat's routine cards, and its YOLO mode. Each part is followed before it is read, and the stream ends when the bot moves to another chat, so the client reconnects onto the new one. `followBotChat` (`bots.stream.ts`) owns every source and their order; `BotStreamEvent` (`apps/web/src/shared/bot-stream.ts`) is the wire contract the server writes and the client reads.
_Avoid_: chat SSE, chat feed (the app-wide `/events` feed is another stream)

**Past chat**:
A bot conversation retired by "New chat", recorded as a `BotChat` row. Read-only until the owner continues it, which moves the bot back onto it; nothing is submitted or reconciled there before that.
_Avoid_: archive, old thread, history (for the record itself)

**Guest**:
Someone the owner added (Settings → People) to chat with the bots shared with them and to use Code: an account with a `guests` row. Every other account is the owner. A guest reaches only the routes `guest.guard.ts` lists.
_Avoid_: member, collaborator, user (for the role)

**Shared bot**:
A bot shared with one or more guests (`bot_guests`). Its chat is one conversation everybody in it sees live: each message carries its `author`, the bot reads it as `Name: message`, replies `[skip]` (hidden) when people only talk to each other, and memory is off.
_Avoid_: group chat, team bot
