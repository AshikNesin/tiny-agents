---
"@groot/web": minor
"@tiny-agents/agent": minor
---

Routines run in conversations of their own and show results as cards in the bot's chat (issue #63).

- `Routine.conversationId` (nullable unique, both engines, migration `routine_conversation`): created on a routine's first fire from the bot's config and reconciled on every fire (`submitToBot` takes an optional routine target). A fire never adds input to the bot's chat or the owner's queued messages, and runs of one routine share their conversation so later runs see earlier ones.
- A finished run shows as a card in the bot's chat, rendered from its `RoutineRun` row and merged into the timeline by finish time. The chat stream sends `routine-runs` on connect and `routine-run` as runs finish. Cards are not transcript entries, so the bot's context is unchanged. A failed submit no longer writes a "paused" notice into the chat; the run's card says so.
- The watcher correlates replies inside the routine's conversation only, so the owner chatting during a run never becomes its output.
- `CapabilitySelection.unattended` (agent): a conversation nobody watches refuses `ask` tool calls instead of waiting (`approval: "refused"` on the tool call, `FinishedReply.refused`), never auto-reviews, and `ask_owner` / `request_credentials` return at once. The watcher fails such a run with the tool named, e.g. "Needs approval for `send_email`; set it to Allow for this bot to use it in routines."
- "Is this a routine turn?" is now `Routine.conversationId = ?` (`conversationOwner` / `isRoutineConversation` in `bots.owner.ts`), used by the recursion guard, the vault, memory, notifications, skills, browser, credential requests and bot-to-bot messaging. The `**Routine "` text checks are gone. The owner can manage routines while a run is working.
- A routine run's `message_bot` gets no answer relayed back, since that would land in the bot's chat. Moving a routine to another bot starts a fresh conversation for it; deleting a routine or its bot stops its conversation.
