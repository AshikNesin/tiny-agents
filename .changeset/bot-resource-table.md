---
"@tiny-agents/agent": patch
---

`BrowserSessions.close(target, { wipeProfile: true })` wipes the profile even
when no browser has it open: it removes the local profile dir, then calls the
transport's new optional `wipe(profileDir)` (the sandbox VM transport deletes
its copy there). `BrowserTransport` is now a callable interface carrying
`wipe`, and `BrowserSession.wipeProfile` is gone.
