---
"tiny-agents": minor
---

Quiet bots (issue #396): a new `message_owner` tool is how a bot speaks when you didn't start the turn. A routine run pushes only what it sends with it, so a run with nothing new stays silent. After a Code hand-off's result or another bot's reply lands in a chat, the bot's own words fold away with its thinking and only what it sent shows, with a "Bot messages" push when you're away. Replies to your own messages are unchanged.
