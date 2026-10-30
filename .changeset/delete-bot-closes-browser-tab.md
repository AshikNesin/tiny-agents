---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Deleting a bot now closes its browser tab. In the shared browser its tab
closes (or, if it was the browser's first tab, goes blank and is freed) and the
other bots' tabs stay as they are; a browser that no bot uses any more closes.
A bot with a browser of its own has that browser closed and its profile
(cookies and logins) wiped. Before, the tab stayed open next to other bots'
tabs until the whole shared browser went idle.
