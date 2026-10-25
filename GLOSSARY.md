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
A message put in front of a bot from somewhere other than its own chat: a mention, a bot-to-bot message, a relayed reply or a routine fire. Each delivery has an idempotent request id.
_Avoid_: dispatch, forward

**Finished reply**:
An assistant reply of a conversation that is no longer busy, with its text and, if the model failed, its error. Relays and routine runs are answered only by finished replies.
_Avoid_: last message, answer

**Question**:
A clarifying question a bot asks the owner mid-reply (`ask_owner`). The reply waits until the owner answers or dismisses it; writing in the chat instead dismisses it.
_Avoid_: prompt, form, survey

**Echo**:
The optimistic copy of an owner's send shown until the server confirms it. It is confirmed by request id when the entry recorded one, otherwise by text.
_Avoid_: pending message, ghost bubble
