# Message Steering (issue #9)

Sending while the bot is replying: the composer stays live, the message
durably joins (or follows) the running reply, and it survives reloads.

## Behavior

| Input                          | Effect                                                                |
| ------------------------------ | --------------------------------------------------------------------- |
| Enter / send button while busy | Steer: placed after the current tool round, the run continues with it |
| Alt+Enter while busy           | Follow-up: placed when the reply ends, starts the next run            |
| Send while idle                | Placed immediately (`whenBusy` is ignored by pi-durable)              |
| The x on a queued bubble       | Withdraws the held message (idempotent; 409 once placed)              |
| Stop button / Esc while busy   | Aborts the reply and withdraws every held message                     |

The composer has **one** round action button: while the bot replies and
nothing is typed it is Stop (a spinner until the run ends); as soon as there
is text or an attachment it is Send, labelled "Steer the reply". Keyboard
hints for Enter / Alt+Enter / Esc fade in as one quiet line under the composer while busy,
on devices with a physical keyboard (fine pointer) only.

## Architecture

```
ChatComposer (always live) → ChatPane.send → POST /bots/:id/messages { whenBusy: "steer" | "followUp" }
  → AgentRuntime.submit(whenBusy) → pi-durable pi.inbox (durable queue)
  → inbox_update event → #refreshQueued (InboxDoc + inspect() records)
  → SSE { type: "queued", items } → store drops the matching optimistic echo
  → placement boundary → upsert (real user message) + queued: []
DELETE /bots/:id/messages/:requestId → AgentRuntime.withdraw
  → abortSubmission → settles unanswered/aborted, leaves the inbox
```

- `ChatState.queued` lists held owner messages (requestId, mode, text,
  attachments); a fresh `watchChat` snapshot seeds it, so a reload keeps
  showing them.
- `queuedOf` filters the inbox to owner messages: write submissions
  (compaction summaries) and peer deliveries (mentions, bot-to-bot relay)
  never render as owner bubbles. Routine prompts never reach the chat at all:
  each routine runs in a conversation of its own (see
  [routines](./routines.md)), so a fire never queues behind, or steers into,
  the owner's reply.
- Withdrawal outcomes: `withdrawn` (200), `already_placed` / `settled`
  (409 — the message is already part of the conversation), `not_found`
  (404). Re-withdrawing a withdrawn input stays `withdrawn`, not 409.

## Semantics worth knowing

- A steer on a text-only reply places at the run's end and the run continues
  with another generation; the queued mode the server reports is the mode
  pi-durable actually honored, so the bubble tag always matches reality.
- Mentions and bot-to-bot deliveries keep the default follow-up behavior;
  only the owner's composer steers.
- The optimistic echo hands off to the queued bubble on the `queued` event
  (matched by requestId), so the message never flickers or doubles.
