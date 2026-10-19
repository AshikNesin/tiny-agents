---
"@groot/web": patch
"@tiny-agents/agent": patch
---

Bot-to-bot relay fix: each delivered message is now answered by the
assistant reply that actually follows it, not the target's latest reply.
A restart sweep can no longer relay a stale pre-delivery reply, and two
messages queued to the same bot each get their own answer relayed back
(one reply could previously answer both, losing the second). Hand-typed
mentions also match case-insensitively ("@ada" reaches "Ada") and the
composer placeholder hints at "@ to tag a bot".
