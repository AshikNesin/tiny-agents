---
"@tiny-agents/agent": minor
---

Bot-to-bot communication (issue #12): tag a bot with @ in any composer and
it receives an attributed copy of the message; its reply relays back into
the host chat as "Reply from <name>". A new "bots" toolkit gives agents a
message_bot(to, text) tool with the same relay back to the sender,
loop-guarded (8 sends per pair per 10 minutes). Delivery is a BotMessage
ledger (pending, delivered, answered) keyed by requestId and sourceKey so
pi-durable tool replays and retried sends never duplicate a message.
