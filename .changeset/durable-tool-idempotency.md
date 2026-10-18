---
"@tiny-agents/agent": patch
---

Key `create_task`'s exactly-once create on the durable tool task (salted with the conversation's persisted `pi.provider` UUID) instead of the provider's tool call id. Call ids come from the upstream model and are only unique within one assistant message: OpenAI-compatible providers may reuse short ids or send none, which made a later create silently return an earlier task (or skip dedup entirely for empty ids). Adds restart tests that close the runtime mid-reply and mid-tool-call and verify the work resumes exactly once.
