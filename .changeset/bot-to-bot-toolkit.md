---
"@tiny-agents/agent": minor
---

Bot-to-bot messaging toolkit (issue #12): the new `createBotsToolkit(store)` adds a `message_bot(to, text)` tool plus a roster prompt section listing the other bots. The app injects a `BotMessagingStore` that owns delivery; the tool derives `sourceKey` and `requestId` from the durable tool task (the `tasks` idempotency key), so pi-durable replays deliver exactly once.
