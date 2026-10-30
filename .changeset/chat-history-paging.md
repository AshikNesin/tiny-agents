---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Long chats open fast and stay fast. Opening a chat, reconnecting, or catching
up after a slow connection used to send and render the whole conversation,
which grows forever (one conversation per bot). The live stream now starts
with the newest 60 messages; scrolling up loads earlier messages 50 at a time
(`GET /api/v1/bots/:id/messages?before=…`) without moving what is on screen,
and a reconnect keeps the history already loaded.
