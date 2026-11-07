---
"tiny-agents": patch
---

A deleted bot's resources are released even when the release is cut off.
Before, a crash or restart during the release, or a sandbox outage that
failed the browser or desktop wipe, left the resource behind for good: the
failure was logged and never retried.

The transaction that deletes the bot row now records each release the bot
owes in the new `bot_releases` table (migration `0008`), with what the
release needs. A release that succeeds removes its row. At boot,
`sweepBotReleases` (`api/bots/bot-resources.ts`) runs every release still
recorded, so a deleted bot's chat that resumed after a crash is stopped and
its own browser profile and desktop are wiped once the sandbox answers.
A release in `BOT_RESOURCES` now gets the bot id and what its `capture`
read in place of the bot row. Each capture names a zod shape, and every
read parses the stored JSON with it. A record that no longer parses is
logged and dropped. The desktop stays owed while `SANDBOX_HOST` is set but
the desktop config is wrong.
