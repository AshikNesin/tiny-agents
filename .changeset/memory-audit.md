---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

Memory costs fewer tokens and dedupes better. A memory a chat learns itself (its background capture, or "remember" in that chat) no longer re-sends the whole "What you remember" block into that chat, which already holds the fact; a memory from anywhere else, or any removal, still refreshes it on the next message, and a new chat starts from the full set. The capture prompt names current memories by short refs (m1, m2) instead of 36-character ids, and clips the bot's replies to 500 characters of context instead of 1,500. "The owner prefers pnpm." and "the owner prefers pnpm" are now the same memory.
