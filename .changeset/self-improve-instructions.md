---
"@tiny-agents/agent": minor
"@groot/web": patch
---

Adds self-improvement: a `self-improve` capability whose `update_instructions` tool lets a bot propose edits to its own system prompt, taking effect from its next message. The tool is `askOnly` — the owner approves every change in chat, with the proposed text on the approval card — and the store adapter refuses writes outside the owner's own turns (routine runs, peer deliveries), the same rule as `remember`. The bot's current instructions render as a prompt section beside the tool. Every applied change (self or manual editor edit) appends a full-snapshot `prompt_revisions` row before the bot row updates, giving append-only, revertable history — the database analog of an instructions file under git.
