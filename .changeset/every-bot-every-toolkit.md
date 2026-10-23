---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Every bot has every built-in toolkit (ADR 0004). The per-bot toolkit
switches and the `toolkits` column are gone; a bot is shaped by its tool
permissions alone (Off removes a tool), and effectful tools still ask first.
Automatic capabilities (vision, tool search, today's date) are marked
`auto` and hidden from the bot's settings, which also drops the Memory and
Vision switches that did nothing. The `time` toolkit is replaced by
`createTodayCapability`, a prompt line with today's date in the owner's
timezone. Routines accept a relative `{ kind: "in", minutes }` schedule
resolved by the tool, and their tool text is shorter. An unconfigured web
toolkit offers the model no tools.
