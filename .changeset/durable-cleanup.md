---
"@tiny-agents/agent": patch
---

Durability follow-ups: `delete_task` remembers (via durable tool memos) that an attempt started and how it ended, so a rerun after a crash reports the delete instead of "No task with id"; chat snapshots load the whole transcript in 500-entry pages instead of only the newest 1000 entries; a failed `AgentRuntime.open` now closes the Harness/storage it opened before releasing the store lock.
