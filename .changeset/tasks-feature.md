---
"@tiny-agents/agent": minor
---

Add task tools: a pi-durable "tasks" extension (create/list/update/complete/delete_task) that lets bots manage the app's task list from chat, replay-safe with callId-keyed exactly-once creates. AgentRuntime.open gains an `extensions` option; testing.ts gains `respondWith` (faux tool-call replies) and re-exports `fauxToolCall`.
