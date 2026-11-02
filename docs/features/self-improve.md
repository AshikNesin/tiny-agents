# Self-improvement

Bots can propose edits to their own instructions (system prompt)
through `update_instructions` — the Grok/Claude Code pattern of an agent
editing the plain-text file that defines it, translated to tiny-agents: the
"instructions file" is the `bots.system_prompt` column, and the tool is the
write access to it.

## The tool

`update_instructions` (capability `self-improve`, in every bot's toolkit)
takes exactly one of:

- `instructions` — the complete new system prompt, replacing the current one
- `append` — lines added to the end of the current prompt

The bot's current instructions also render as a `## Your current instructions`
prompt section, so the model can read what it is about to change.

## Two guards

1. **The owner approves every change.** The tool is `askOnly` (like
   `save_skill`): it waits in chat even when its permission says `allow`.
   The approval card shows the full proposed text in its Input block, so the
   owner never approves blind. There is no configuration that removes this
   gate.
2. **Only the owner's own turns can change instructions.** The store adapter
   (`apps/web/src/server/api/bots/self-improve.store.ts`) refuses the call in
   a routine run or when the latest message came from another bot (the same
   `isUnattended` rule as `remember`), so a peer can never plant a prompt.

## History

Every applied change appends a full-snapshot `prompt_revisions` row before
the bot row updates — the database analog of one instructions file under
git, one commit per change:

- `prompt` — the complete system prompt after the change
- `source` — `self` (the tool) | `manual` (the bot editor records here too)
- `botId`, `createdAt`

Reverting is asking the bot (or the editor) to set the text of an earlier
revision — which itself lands as a new revision, so the log stays append-only.
The current prompt always lives in `bots.system_prompt`; revisions are only
the log.

The row update means the running conversation's config still holds the old
prompt for the rest of the reply; `reconcileBotConversation` re-applies the
row on the next submit, so new instructions take effect from the bot's next
message.

## Enabling a connection

The same capability lets a bot ask for one of the owner's connections it is
not linked to — the "an Exa connector would help here, enable it?" moment:

- A `## Connections you could use` prompt section lists, in the bot's chat
  only, the owner's connections not linked to the bot (slug, name and a few
  tool names). Connections with no tools yet (never connected, sign-in
  unfinished) are left out, and the section is absent when nothing is left.
- `enable_connection({ name: "<slug>" })` is `askOnly`: the owner sees an
  approval card ("wants to enable a connection · exa") and approves or
  denies. Denying leaves the bot as it was.
- On approval the adapter inserts the `bot_connections` row and calls
  `reconcileBotConversation` before the tool returns. The runtime applies a
  configure from the next model request, so the connection's tools are usable
  in the same reply — the owner does not have to send another message.
- The `isUnattended` rule applies here too: routine runs and peer deliveries
  are refused.

Linking is permanent, the same as ticking the connection in the bot editor;
the owner unlinks it there.

## Tests

- `tests/server/app/agent/self-improve.test.ts` — the capability: section
  renders, `askOnly` holds even at `allow`, refusals reach the model, the
  connections section lists offers and `enable_connection` waits for approval.
- `tests/server/api/bots/self-improve.store.test.ts` — the adapter: replace
  and append write the row plus one revision each, unattended turns and
  unknown conversations refuse without side effects; connection offers skip
  linked and tool-less ones, enabling links and reconciles, unknown names and
  peer turns refuse.
