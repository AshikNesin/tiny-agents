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

**Settled**:
A conversation whose reply finished and went idle. Settling answers its Deliveries, resolves its awaiting routine runs and updates the bot list, in that order, from one read of the transcript (`bots.settled.ts`).
_Avoid_: done, finished (for the conversation)

**Question**:
A clarifying question a bot asks the owner mid-reply (`ask_owner`). The reply waits until the owner answers or dismisses it; writing in the chat instead dismisses it.
_Avoid_: prompt, form, survey

**Echo**:
The optimistic copy of an owner's send shown until the server confirms it. Its request id is minted once and reused by every retry (an offline send keeps its Echo and goes again once the browser is back), and it is confirmed by that request id. Only an older entry without one is matched by text, and never one created before the Echo.
_Avoid_: pending message, ghost bubble

**Past chat**:
A bot conversation retired by "New chat", recorded as a `BotChat` row. Read-only until the owner continues it, which moves the bot back onto it; nothing is submitted or reconciled there before that.
_Avoid_: archive, old thread, history (for the record itself)
