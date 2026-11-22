---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

Guests stay inside the bots they are shared with when a message names other bots. An @mention from a guest now reaches only the bots that guest can open; the others are dropped without an error, and the mentioned bot reads who actually wrote it (`[From Priya, in Host's chat]`) instead of being told the words are the owner's. A bot whose chat is shared with guests can no longer message, through `message_bot`, a bot those guests cannot see: the send is refused with the reason `shared`, and the roster it is offered lists only the bots every guest of that chat can open. The owner's own chats are unchanged.
