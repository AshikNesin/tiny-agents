# tiny-agents

A messenger where every contact is an AI bot. Each bot is a row in app.db
paired with a durable conversation in agent.db (pi-durable).

## Language

**Bot**:
A contact the owner chats with: persona, model, tool permissions and links, stored as the `Bot` row.
_Avoid_: agent, assistant, contact

**Bot conversation**:
The durable pi-durable conversation a bot runs on, linked by `Bot.conversationId`. It runs on the config from its last configure, so it is reconciled from the row before every submit.
_Avoid_: thread, session, chat (for the durable side)

**Reconcile**:
Re-apply a bot's row (model, persona, permissions, toolkits, connections) to its bot conversation. Only `bots.conversation.ts` does this.
_Avoid_: reconfigure, sync

**Delivery**:
A message put in front of a bot from somewhere other than its own chat: an owner @mention or a bot-to-bot message. Each is a `bot_messages` row with an idempotent request id, pinned to the target conversation it was submitted to, and answered with that request's Finished reply, relayed into the asking bot's chat. `bots.delivery.ts` owns all of it.
_Avoid_: dispatch, forward

**Finished reply**:
What a submission's turn came to once its conversation is no longer busy: the turn's last message with text or an error, plus every tool refused in the turn and the newest blocked reason. Found by the submission's request id (`finishedReplyTo`), never by time. Deliveries and routine runs are answered only by Finished replies.
_Avoid_: last message, answer

**Turn**:
Everything from one user message up to the next: the assistant messages (often several, one per tool round) that answer it.
_Avoid_: exchange, round (a turn has several tool rounds)

**Routine run**:
One firing of a routine at one slot: a `routine_runs` row that is missed, failed, or awaiting its Finished reply in the routine's own conversation, then succeeded, blocked or failed. `routines.runs.ts` owns every state change and the card and push that follow.
_Avoid_: job, execution

**Harness**:
A coding agent tiny-agents drives but does not implement — Shelley, Claude Code — plugged into the Code page through one adapter contract (`HarnessInstance`, `packages/code`). An instance is one configured harness (`shelley`, `claude-code`); a thread is addressed `<instance>:<native id>`. The harness owns the transcript; tiny-agents keeps only the thread index (ADR 0011).
_Avoid_: provider (model providers), backend, engine (bot engines)

**Capability**:
What a harness really does (steer, approvals, diffs, …), declared by its driver. The Code page shows a control only when the thread's harness has its capability; it never fakes one.
_Avoid_: feature flag

**Thread feed**:
What one harness thread's watchers are sent, and when (`ThreadFeed`, `@tiny-agents/code/server`). A driver tells it the thread as it is now (a snapshot, the full row list, the streaming text, a state change); the feed sends each watcher its snapshot first, then only rows that changed for it, re-sends the streaming text after a snapshot, and keeps one failing watcher from stopping the others. `threadEventProblems` in `@tiny-agents/code/testing` checks any driver's watch against the same rules.
_Avoid_: watcher (the app's hand-off `code.watcher.ts`), tracker, stream (Shelley's `stream2`)

**Shelley**:
The owner's coding agent on another machine ([boldsoftware/shelley](https://github.com/boldsoftware/shelley)), one harness of the Code page and the default for bot hand-offs. tiny-agents is a client of its official API (ADR 0009, ADR 0011).
_Avoid_: coder, coding bot

**Claude Code harness**:
Claude Code on the sandbox, driven through the Claude worker's coding mode (ADR 0012): built-in tools on, a plain working directory, `acceptEdits` by default. Not the Claude plan bot engine, which keeps Claude Code's tools off (ADR 0008).
_Avoid_: Claude engine (that is the bot engine)

**Hand-off**:
A bot giving coding work to a harness with `code_start` (or `shelley_start`): a `code_handoffs` row whose finish is delivered once into the bot's chat as a reply from that harness.
_Avoid_: job, delegation

**Steer**:
A message sent to a harness while its turn runs: it goes into that turn. Queue holds a message for when the turn ends instead.
_Avoid_: interrupt (Stop interrupts)

**Vault use**:
One resolution of a vault item's value into a sink, after policy, the owner's approval and a re-check of the target. `VaultUse` names the item, the sink tool, the target and its kind (origin, host, command, connection); the audit row records what the sink did, never what was meant. `vault.service.ts` owns the policy and the audit; `useFromSink` in the agent package is the one sequence every sink follows.
_Avoid_: fill, lookup, secret access

**Sink**:
The tool that receives a vault value: a browser field, a request header, a confined command's environment, an MCP connection's header. A sink declares its target kind; it never sees policy.
_Avoid_: consumer, client

**Settled**:
A conversation whose reply finished and went idle. Settling resets the sender's per-turn budget, then answers its Deliveries, resolves its awaiting routine runs, updates the bot list, pushes a failed or long reply to the owner and arms memory capture, in that order, from one read of the transcript, one lookup of who is behind the conversation and one record of when the reply started. `startSettledPipeline` (`bots.settled.ts`) builds every step from the opened runtime, subscribes once, then runs each step's boot sweep. Nothing else listens for idle.
_Avoid_: done, finished (for the conversation)

**Side-call**:
A one-shot model call the app makes off the reply path: memory capture, Past chat titles. `createSideCaller(runtime).complete` (`side-call.ts`) picks the model (an override the runtime knows, else the bot's own), aborts it at its deadline, and turns any failure into no answer, logged. Callers take it as a port; faux mode has none, so it makes no side-calls.
_Avoid_: background call, LLM call

**Model catalog**:
What every model id means (`ModelCatalog`, `model-catalog.ts`, `runtime.catalog`): the id grammar (bare for the primary provider, `custom:<provider>/<model>`, `claude-code/<model>`), what the picker lists (configured providers, then GATEWAY_MODEL_ALLOWLIST), which ids a bot can run on, the registry model an id resolves to, whether a model sees images, and the providers' status. Nothing else parses or builds a model id.
_Avoid_: model list, model registry (that is pi-ai's, which the catalog reads)

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
One live browser per profile, owned by the session manager (`toolkits/browser-sessions.ts`): open, peek (never launches), the driver flag (owner or bot), the idle sweep, close (which cancels an open still in flight). The toolkit, the vault sinks and the app's browser routes all hold the same manager instance; nothing reads a module global.
_Avoid_: tab (a session has tabs), browser instance

**Computer**:
A bot's desktop (issue #108): XFCE on the sandbox VM, one per browser profile, which the bot sees with screenshots and drives with clicks, keys and typing (`computer_*` tools). Not the owner's machine, and not the sandbox's shell, which stays `run_command`.
_Avoid_: VM (the VM hosts several desktops and the shell), workstation

**Desktop**:
One live computer: an X display served by Xtigervnc with an XFCE session on it, at a fixed size, owned by the computer session manager (`toolkits/computer-sessions.ts`) through the `ComputerDesktop` port. It survives an app crash and is reattached by the next launch for its profile.
_Avoid_: screen (a screenshot is of a desktop), display (the X display number)

**Live view**:
The owner's noVNC view of a bot's browser or desktop in the chat (`BrowserPanel`, `ComputerPanel`), view-only until the owner takes control. Reached through a one-time ticket and an SSH channel; never a screenshot stream.
_Avoid_: screencast, preview

**Sandbox connection**:
The app's one SSH connection to the sandbox VM or the local sandbox container (`SandboxConnection`, `ssh/sandbox-connection.ts`), built once from the endpoint and handed to every user: the sandbox toolkit, attachments, the terminal, the computer, the browser and the Claude worker. It runs execs, ptys, file transfers and forwards as channels on one pooled connection, and owns the host-key pinning, the retry rule, the idle close and the "Cannot reach the sandbox" wording (ADR 0013).
_Avoid_: endpoint (that is only the address), SSH session, transport (a computer or browser transport sits on top of it)

**Worker connection**:
The app's side of one WebSocket to the Claude worker (`WorkerConnection`, `@tiny-agents/claude-worker/client`). The Claude plan bot engine and the Claude Code harness each put their protocol on one (turns and tool results; `coding.*` requests) and never see a socket. It owns the heartbeat and silence close, reconnecting with backoff while finding the worker again on every attempt, the handshake and the `welcome` boot id that tells a worker restart from a dropped socket, a resume cursor per session, requests and their replies, the queue while disconnected, and the wording of a refused token or an HTTP status.
_Avoid_: worker client (that is a protocol layer on it), tunnel (that is the Sandbox connection's forward under it), socket

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
