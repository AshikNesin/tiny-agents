---
"@groot/web": minor
---

Deliveries, routine runs and the chat's Echo are each owned by one module.

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
