---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Fix memory capture and injection, and add forgetting from chat (issue #64).
Injection now keeps the newest memories as whole lines when the block passes
6,000 characters, with an accurate omitted count; before, it cut the newest
facts (and later categories) mid-sentence. `renderMemoryBlock` and its
constants moved into `@tiny-agents/agent`, and `MemoryLine` gains `createdAt`.
Turning memory back on starts capture from that moment, so nothing said while
it was off is remembered. One capture reads at most the newest 24,000
characters and still advances the watermark, so a long backlog no longer
retries forever. `remember` is refused in routine runs and peer turns, even
with Always allow, using the vault's `isUnattended` check (now shared in
`bots.unattended.ts`). The capture prompt lists the 30 newest deleted
memories, so they don't come back reworded. A new `forget({ text })` tool
(default Ask, same refusals) tombstones the matching memories and returns
what it removed.
