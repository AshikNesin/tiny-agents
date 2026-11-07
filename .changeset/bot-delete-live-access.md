---
"tiny-agents": patch
---

Deleting a bot now ends every live connection to it. Before, a guest's or
another tab's open chat stream of the deleted bot, its open desktop viewers
and its unredeemed viewer tickets kept working until the client
disconnected or the sandbox closed the desktop.

`revokeLiveAccess` (`api/people/live-access.ts`) now takes the person, the
bot, or both, and the bot's `liveAccess` entry in `BOT_RESOURCES` revokes
by bot after the row is deleted. It replaces the `chatStreams` entry, which
kept those streams open on purpose.
