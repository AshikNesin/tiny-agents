---
"@tiny-agents/agent": minor
"@groot/web": patch
---

Deepen bot delivery and reply reading (architecture review):

- Every message put in front of a bot (owner sends, mentions, relayed
  replies, bot-to-bot `message_bot`, routine fires) now goes through one
  module, `bots.conversation.ts`, which reconciles the durable conversation
  with the bot row before submitting. `message_bot` previously skipped the
  reconcile, and a routine whose bot model was removed retried forever
  instead of pausing, because the reconcile ran outside its error handling.
- `AgentRuntime.finishedReplies(ref)` returns a conversation's finished
  assistant replies (none while busy), with `error` set on a model failure.
  The bot-to-bot relay and the routine completion watcher both use it. The
  watcher previously looked for a "⚠" prefix that chat messages never carry,
  so a routine run whose reply failed stayed "awaiting".
- Owner sends that write a `chat.user` entry (attachments, peer deliveries)
  record their request id, exposed as `ChatMessage.requestId`. The chat
  store uses it to confirm optimistic echoes, so a send with a file no longer
  leaves a duplicate pending bubble next to the server-annotated message.
- The sidebar approvals badge updates while a bot is still replying.
- The real and faux runtime boots share their post-open wiring.
