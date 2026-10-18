---
"@groot/web": patch
---

Fix "New chat" not clearing the transcript, and a blank-screen crash when opening the New bot dialog.

- New chat: the SSE stream stays bound to the bot's old (retired) conversation, so after a reset the stale transcript stayed on screen and kept growing. The chat store now drops the cached ChatState on reset (`resetChat`) and the chat pane reconnects its stream when the bot's `conversationId` changes — the fresh snapshot of the new conversation replaces the old transcript.
- New bot dialog: `/api/v1/capabilities` returns `{ capabilities }`, but `botsApi.capabilities()` was typed as the bare array, so `capabilities.filter` in BotDialog threw `TypeError: capabilities.filter is not a function` during render and unmounted the whole React tree (blank page). The client now unwraps the envelope.
