---
"@tiny-agents/agent": patch
---

Chat: a message you queued (Alt+Enter) and one you steered in while the bot
was replying no longer shows "No reply was produced for this message" when a
single reply answers both. Back-to-back messages that share one reply now count
as answered; a message the runtime recorded as unanswered (for example stopped
before a reply started) is still flagged.
