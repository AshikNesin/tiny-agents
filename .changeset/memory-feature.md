---
"@tiny-agents/agent": patch
"@groot/shell": patch
---

Adds durable per-bot memory (issue #22 phase A): a `memories` table with a typed lifecycle (active/superseded/archived/expired/deleted), a `memory` capability section that injects what a bot remembers about the owner into its prompt on every send, `Bot.memoryEnabled` with capture/injection gating, and REST CRUD under `/api/v1/bots/:id/memories` with tombstone deletes that block exact-text re-capture. Overflow archives the oldest active rows at a 100-row budget, never truncating new facts.
