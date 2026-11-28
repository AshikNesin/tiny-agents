---
"@tiny-agents/code": minor
"tiny-agents": patch
---

A Code thread id with no instance in front (`cA` rather than `shelley:cA`) is no longer read as a Shelley conversation. Such ids were last written before Code had more than one coding agent, and every saved one was given its prefix when the old Shelley tables were dropped. A thread opened by an id the app does not know now answers "not found" instead of asking Shelley for a conversation of that name.

`@tiny-agents/code` removes `LEGACY_INSTANCE_ID` and the second argument of `parseThreadId`.
