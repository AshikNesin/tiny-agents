---
"@tiny-agents/agent": minor
---

Grok-style bot-to-bot transcript UI: add `@tiny-agents/agent/peer-envelope`
with `parsePeerEnvelope` / `stripPeerEnvelope`, a shared parser for the
system attribution prefixes the delivery pipeline writes ("Reply from X:",
"Message from X (bot):", "[From the owner, in Y's chat]"). The web client
now renders cross-bot traffic as attributed cards — peer avatar + name
header for relays and message_bot deliveries, a "You · in {host}'s chat"
label for mentions, and an avatar handoff pill for the message_bot tool row
— instead of raw prefixed bubbles, and bot-list previews show the payload
rather than the prefix. The stored text and everything the model reads is
unchanged.
