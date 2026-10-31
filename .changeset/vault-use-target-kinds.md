---
"@tiny-agents/agent": minor
"@groot/web": minor
---

A vault use names its target's kind. `VaultUse.targetKind` (`origin`, `host`,
`command`, `connection`) says how the item's policy reads `target`, so the
vault no longer branches on tool names and a new sink declares its kind
instead of editing policy. Sinks share one sequence, `useFromSink` (grant,
gate decision, moved-target refusal, broker use), instead of each repeating
it. A sink that throws is audited `sink_error` (new `VaultOutcome`) and does
not bump the item's last use; before, it was audited `used`. A connection's
secret resolves through the same policy check as every other use. The vault
raises owner alerts through `vault.alerts.ts` rather than importing the
notification wiring. Credential requests record the bot on their audit rows,
refuse a second submit while one is filling, and settle as filled even when
saving the login to the vault fails afterwards.

Alongside: `conversationOwner` returns the bot behind a conversation (id,
name, model, browser profile, memory flag) and whether it is the bot's chat
or a routine's, so no caller re-joins the bot row; `chatOwner` names the
chat case. Push notifications for a failed or long reply and memory
capture's debounce are steps of the settled pipeline (`bots.settled.ts`),
which now records when each reply started; nothing else listens for idle.
A Turn that settles while a memory capture is running re-arms the quiet
window instead of being dropped.
