---
"@groot/web": patch
---

The Browser panel stays closed once you close it. It still opens on its own the
first time a bot uses its browser in a conversation, but after you close it,
later browser calls in that run, the next run or after a reload no longer pop
it back over the chat (on a phone it covered the whole transcript). Before, any
new message in the transcript re-armed the auto-open. The header's Browser
toggle now shows on mobile too, with a pulsing dot while the bot is browsing
and the panel is closed. A new chat starts fresh. The faux e2e model gains
`/browse N` to exercise this.
