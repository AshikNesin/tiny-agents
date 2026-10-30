# Routines: where runs happen

A routine runs a prompt for a bot on a schedule (issue #18). This page covers
where each run happens and how its result reaches the owner (issue #63). The
schedule engine itself (exactly-once fires, grace, the `routine-fire` job)
lives in `apps/web/src/server/api/routines/routines.jobs.ts`.

## One conversation per routine

Each routine has a durable conversation of its own (`Routine.conversationId`).
It is created on the routine's first fire, from the bot's config, and every
later run of that routine is submitted to it. A run never adds anything to
the bot's chat, or to the owner's queued messages.

- **Context.** Runs of one routine share a conversation, so a routine that
  should "only report new things" still sees what its earlier runs said, and
  compaction works on that conversation alone. The bot's chat keeps only the
  owner's messages.
- **Reconcile.** Each fire goes through `submitToBot` with the routine's
  conversation as its target, which reconciles that conversation from the
  bot's row first, as it does for the chat.
- **Moves and deletes.** Moving a routine to another bot clears its
  conversation (the next fire starts a fresh one for the new bot), stops the
  old one, and cancels a run still awaiting there. Deleting a routine or its
  bot stops its conversation. Old conversations stay in agent.db, hidden, like
  a chat's after "New chat".

Routine runs still have their bot's identity: tool calls in a routine's
conversation resolve to the bot through `conversationOwner`
(`bots/bots.owner.ts`), so a run gets the bot's skills, browser, memories and
vault items. Memory capture reads only the chat, never a routine's
conversation.

## Nobody is there to ask

A routine's conversation is configured `unattended`
(`CapabilitySelection.unattended`, written to the conversation's permissions
document). In it:

- An **Ask** tool is refused instead of waiting for an approval nobody sees.
  The tool call gets `{ approval: "refused" }`, the model is told it did not
  run, and the watcher fails the run with the reason, for example "Needs
  approval for `send_email`; set it to Allow for this bot to use it in
  routines." Tools that always ask (`save_skill`) say routines can't use them.
  **Allow** tools run as usual.
- Auto-review never runs.
- `ask_owner` returns at once and tells the model to carry on, and
  `request_credentials` opens no sheet.
- Vault uses, `remember` and `forget` are refused as unattended
  (`isUnattended` in `bots/bots.unattended.ts`).
- The routines toolkit refuses to create or manage routines (the recursion
  guard); `list_routines` stays open. The owner's chat is never a routine's
  conversation, so the owner can manage routines while a run is working.

## Results show as cards in the chat

The watcher (`routines.watcher.ts`) resolves an awaiting run when its
routine's conversation goes idle. Only routine prompts go into that
conversation, so the run's output is always the routine's own reply, even if
the owner chats during the run.

A finished run (succeeded, failed, missed, cancelled) shows in its bot's chat
as a card built from the `RoutineRun` row: the routine's name, status, output
preview, error and time (`routines.cards.ts`, `RoutineRunCard.tsx`). The card
is not a transcript entry. It costs no model turn and the bot never reads it.

- The chat stream (`GET /bots/:id/stream`) sends `{ type: "routine-runs" }`
  with the bot's 50 newest finished runs on connect, then
  `{ type: "routine-run" }` as each one finishes.
- The client merges cards into the timeline by when the run finished
  (`lib/chat-timeline.ts`).
- A run whose submit failed pauses the routine. Its card says so; no notice
  is written into the chat.
- Pushes are unchanged (`routine.succeeded`, `routine.failed`, see
  [notifications](./notifications.md)).
