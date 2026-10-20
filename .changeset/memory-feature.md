---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Adds durable per-bot memory (issue #22 phase A): a `memories` table with a typed lifecycle (active/superseded/archived/expired/deleted), a `memory` capability section that injects what a bot remembers about the owner into its prompt on every send, `Bot.memoryEnabled` with capture/injection gating, and REST CRUD under `/api/v1/bots/:id/memories` with tombstone deletes that block exact-text re-capture. Overflow archives the oldest active rows at a 100-row budget, never truncating new facts.

Capture (phase B): idle chats arm a per-conversation debounce (2 minutes quiet or 6 owner turns); one gateway side-call reads the owner turns since the watermark through an anti-junk extraction contract, and code alone decides what lands — exact-text dedupe against tombstones, same-bot supersession, budget archive, watermark bump in one transaction. Trivial windows and peer/routine turns never trigger a call; faux mode and missing gateway config disable capture without affecting manual memories or injection.
