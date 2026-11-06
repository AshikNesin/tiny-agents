---
"@groot/web": minor
---

One module decides a bot's toolkits: `apps/web/src/server/api/bots/bot-toolkits.ts`
holds the list of built-in toolkit ids (`BOT_TOOLKITS`), the one parser for a
connection's cached and disabled tools, the "large connection needs tool
search" rule, and `botToolkits()`, the selection every bot's conversation runs
with. The bot conversation and the ConnectionManager both ask it instead of
keeping their own copies. At boot the server logs a warning if a bot would
select a toolkit the runtime has not installed (such an id used to be
ignored silently), and a test fails when the two drift apart. The server test
runtime installs the app's own toolkits from the same source as the server
(`appStoreCapabilities`). Every bot's selection is unchanged.
