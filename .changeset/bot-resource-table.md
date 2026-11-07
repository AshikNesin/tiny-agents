---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Deleting a bot releases everything it owned, listed in one table.

- `@tiny-agents/agent`: `BrowserSessions.close(target, { wipeProfile: true })`
  wipes the profile even when no browser has it open. It removes the local
  profile dir, then calls the transport's new optional `wipe(profileDir)`
  (the sandbox VM transport deletes its copy there). `BrowserTransport` is
  now a callable interface carrying `wipe`, and `BrowserSession.wipeProfile`
  is gone.
- `@groot/web`: every per-bot resource has one entry in `BOT_RESOURCES`
  (`apps/web/src/server/api/bots/bot-resources.ts`), and `deleteBot` runs
  them all. A deleted bot's queued routine jobs are cancelled, its vault
  grants are dropped, and its own browser profile and desktop are wiped even
  after it switched to the shared browser.
