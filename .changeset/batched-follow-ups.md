---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

Messages that queue while a bot is replying (your follow-ups, hand-off results, other bots' replies) are now answered together in one run instead of one run each, which saves a model request per extra message (issue #396). Each queued message still gets the shared reply, and a batch you wrote in is never folded away as a quiet turn.
