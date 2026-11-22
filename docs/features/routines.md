# Routines: where runs happen

A routine runs a prompt for a bot on a schedule (issue #18). This page covers
where each run happens and how its result reaches the owner (issue #63). The
schedule engine itself (exactly-once fires, grace, the `routine-fire` job)
lives in `apps/web/src/server/api/routines/routines.jobs.ts`.

Routines is also the reference feature module: it has every layer a feature
can have. To build a new feature the same way, follow
[Adding a feature end to end](../guides/development.md#adding-a-feature-end-to-end).

```
apps/web/src/server/api/routines/
├── routines.schema.ts    # Zod schemas
├── routines.service.ts   # Drizzle queries + Boom errors
├── routines.routes.ts    # Hono router, mounted by createWebApp() in app.ts
├── routines.jobs.ts      # the routine-fire job, registered by registerRoutineJobs()
└── routines.*.ts         # helpers: arming, cards, runs, schedule, toolkit-store, watcher
apps/web/src/server/db/schema.ts           # the `routines` and `routine_runs` tables
apps/web/src/client/pages/routines/        # the Routines page
apps/web/src/client/lib/routines-api.ts    # typed client for the API
tests/server/routes/routines.routes.test.ts  # the HTTP API through createTestApp()
tests/server/api/routines/                 # arming, engine, once, rearm, schedule, toolkit-store
tests/client/pages/routines.test.tsx       # the page
```

## A fresh conversation per run

Each run gets a durable conversation of its own (`RoutineRun.conversationId`),
created from the bot's config when it fires, like a cron job's isolated
session in OpenClaw or Hermes Agent. A run never adds anything to the bot's
chat, to the owner's queued messages, or to an earlier run's conversation.

- **Why.** Runs used to share one conversation per routine, so every model
  request of every run re-sent the routine's whole history (earlier prompts,
  replies and tool results such as fetched pages) until compaction kicked in
  near the context window. A routine every 15 minutes sent well over 100k
  tokens per request. Now a run pays only for its own prompt and tool calls.
- **Continuity.** The prompt quotes the routine's three latest succeeded
  results, newest first and trimmed to 500 characters each
  (`recentResults`, `composeRoutinePrompt`), so a routine that should "only
  report new things" still can. They are data, not instructions.
- **Exactly once.** The conversation is recorded on the run row before the
  submit (`reserveRunConversation`), so a redelivered or retried fire reuses
  it and the request id dedupes the submit. `Routine.conversationId` names the
  newest run's conversation, the one a move or a delete stops.
- **One run at a time.** A fire while the routine's previous run is still
  working is recorded `missed` ("Skipped: the previous run was still
  working.") instead of queuing behind it; the chain moves on.
- **Token budget.** A run's conversation carries a budget
  (`ROUTINE_RUN_TOKEN_BUDGET`, 500k tokens, cache reads included,
  `CapabilitySelection.budgetTokens`). Once it is spent, the Tool gate
  refuses every call and tells the model to answer with what it has; at 1.5x
  the run is stopped. The run's spend is stored on its row (`tokens`, shown
  on the Routines page), and a run over budget is recorded `blocked` with the
  reason, so three in a row pause the routine.
- **Moves and deletes.** Moving a routine to another bot or deleting it (or
  its bot) stops its newest run's conversation and cancels a run still
  awaiting there. Old conversations stay in agent.db, hidden.

Routine runs still have their bot's identity: tool calls in a run's
conversation resolve to the bot through `conversationOwner`
(`bots/bots.owner.ts`), so a run gets the bot's skills, browser, memories and
vault items. Memory capture reads only the chat, never a routine's
conversation.

## A progress note across runs

A routine can keep a short note for its next run (`routines.progress`, at
most `MAX_PROGRESS_CHARS`), for work that spans runs: a list worked through
a few items a day, or a value to compare against next time. A run replaces
it with `save_routine_progress`, a tool shown only in unattended runs
(`unattendedOnly`) and allowed by default, so chats pay nothing for it. The
store refuses any conversation that is not a routine run. When a note is
set, the next run's prompt carries it in place of the three quoted results
(`composeRoutinePrompt`), so a note costs about what the quotes did. The
owner reads, edits or clears it as **Progress note** in the routine's editor.

## Webhook routines

A routine whose schedule is `{ kind: "webhook" }` has no clock. It runs when
its URL gets a POST, with the request body as its input (issue #503). The
rest is the same as a clock routine: a fresh conversation, the token budget,
`message_owner`, and the blocked-run pause. The code is
`apps/web/src/server/api/routines/routines.hooks.ts`.

- **The URL.** **Webhook URL** on the card (`POST /routines/:id/hook`) makes a
  new secret URL, `/api/v1/routines/hooks/<token>`, and shows it once. Only
  the token's SHA-256 is stored (`routines.hook_token_hash`), so a new URL
  stops the old one. A paused routine answers 409, an unknown token 404.
- **Acknowledge, then work.** The handler stores the delivery as a
  `routine_events` row, queues a `routine-fire` job with trigger `webhook`,
  and answers 202. Nothing else runs on the request.
- **Once per delivery.** The delivery id is the first of the
  `Idempotency-Key`, `X-GitHub-Delivery`, `X-Delivery-Id` or `X-Request-Id`
  headers, or else a hash of the body. A repeated id answers 200 with
  `duplicate: true` and runs nothing.
- **Data, not instructions.** Each payload is clipped
  (`HOOK_PAYLOAD_CHARS`) and quoted into the run's prompt in a fenced block,
  under a line saying it came from outside and is data.
- **Deliveries batch.** A delivery that arrives while a run is working is not
  recorded `missed`: it waits. When the run settles (or a restart interrupts
  it), any waiting deliveries start the next run together, up to
  `HOOK_EVENTS_PER_RUN`, oldest first.
- **An hourly cap.** Past `HOOK_RUNS_PER_HOUR` webhook runs in the last hour,
  deliveries wait for one delayed fire at the moment the window frees, so a
  noisy sender cannot run up the bill.

## Nobody is there to ask

A run's conversation is configured `unattended`
(`CapabilitySelection.unattended`, written to the conversation's permissions
document). In it:

- An **Ask** tool is refused instead of waiting for an approval nobody sees.
  The tool call gets `{ approval: "refused" }`, the model is told it did not
  run, and the watcher fails the run with the reason, for example "Needs
  approval for `send_email`; set it to Allow for this bot to use it in
  routines." **Allow** tools run as usual.
- Tools that always ask (`askOnly`: `save_skill`, `create_bot`,
  `update_instructions`, `computer_close_window`, `computer_clipboard_get`)
  and chat-only ones (`chatOnly`: `ask_owner`) are not
  offered at all (`hiddenWhere` in `packages/agent/src/capabilities.ts`), so
  the run does not pay for their schemas on every request.
- Auto-review never runs.
- `request_credentials` opens no sheet.
- Vault uses, `remember` and `forget` are refused as unattended
  (`isUnattended` in `bots/bots.owner.ts`).
- The routines toolkit refuses to create or manage routines (the recursion
  guard); `list_routines` stays open. The owner's chat is never a routine's
  conversation, so the owner can manage routines while a run is working.

## A run speaks only through `message_owner`

Nobody reads a run's reply as a message (issue #396, after the Grok bot's
"send user" tool). The reply is the run's result, stored on its row and quoted
to later runs, but the owner is told only what the run sends with
`message_owner`. A succeeded run that sends nothing sends no success push
(failed, missed and paused runs still push `routine.failed`), so a routine that
"tells me when something changed" stays silent until it does. The run
guidance says so; the sent texts reach the watcher as `FinishedReply.sent`.

## How often a routine messages you

Each settled run stores how many `message_owner` messages it sent
(`routine_runs.messages`). The Routines page shows, per routine, how many of
its last 10 such runs messaged you (`messageRate`, computed in
`routines.service.ts`). A routine that messaged you in every one of at least
5 runs gets a hint to tell it, in its prompt, to stay quiet when nothing is
new. Nothing here calls a model. Runs from before the column count as
neither.

## Results show as quiet lines in the chat

The routine runs step of the settled pipeline (`routineRunsStep`,
`routines.watcher.ts`; see Settled in GLOSSARY.md) resolves an awaiting run
when its run's conversation settles, reading only that conversation's
awaiting runs. Its boot sweep resolves or marks interrupted the runs a
restart left awaiting, and re-arms routines whose fire job is gone. Only routine prompts go into that
conversation, so the run's output is always the routine's own reply, even if
the owner chats during the run.

A finished run (succeeded, failed, missed, cancelled) shows in its bot's chat
as one quiet, centered line built from the `RoutineRun` row (`routines.cards.ts`,
`RoutineRuns.tsx`): the routine's name, status and time, styled like the day
divider. Runs that finish back to back (no message between them, same day)
fold into one line ("ran 4× · 1 failed · last 09:00"). Clicking the line shows
each run's output and error, newest first, with a link to the Routines page.
It is not a transcript entry: it costs no model turn and the bot never reads
it.

- **Per thread.** Lines belong to the chat thread they finished in.
  `Bot.chatStartedAt` is set when the bot is created and on "New chat"; only
  runs that finished after it show. Earlier results stay on the Routines page.
- The chat stream (`GET /bots/:id/stream`, `followBotChat` in `bots.stream.ts`) sends `{ type: "routine-runs" }`
  with the thread's 50 newest finished runs on connect, then
  `{ type: "routine-run" }` as each one finishes.
- The client merges them into the timeline by finish time
  (`lib/chat-timeline.ts`).
- A run whose submit failed pauses the routine. Its line says so; no notice
  is written into the chat.
- Pushes: `routine.succeeded` carries what the run sent, and only when it
  sent something; `routine.failed` is unchanged (see
  [notifications](./notifications.md)).
