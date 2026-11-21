---
"tiny-agents": patch
"@tiny-agents/sandbox": patch
---

The local browser's navigation guard refuses a name whose DNS lookup fails or times out, instead of leaving it to the browser, so a name that can't be checked can't reach a private address. An exempt name still goes through.
