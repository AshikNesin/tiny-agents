---
"tiny-agents": patch
---

Drops leftovers of finished migrations: the `shelley_seen` and `shelley_handoffs` tables and their copy at boot (copied into the Code tables on every boot since ADR 0011), the unused `memories.confidence` column, the old `tiny-agents:shelley-*` composer settings, and the text-and-clock match that let a chat message without a request id confirm a just-sent message.
