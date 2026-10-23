---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Bots share one browser profile by default. The browser toolkit now keys live
browsers by profile (`BrowserTarget`: profile plus tab): bots on one profile
share one Chrome, and so its logins, each driving a tab of its own, with the
acting bot's tab brought to the front. A bot can be switched to its own
profile in the bot dialog (new `browserProfile` column, `"shared"` or `"own"`).
Taking control and Reset act on the whole shared browser; the panel warns
before a reset signs every bot out. Existing per-conversation profiles are no
longer used, so sites need one fresh sign-in on the shared profile.
