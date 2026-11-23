---
"@tiny-agents/claude-worker": patch
"@tiny-agents/code": patch
"tiny-agents": patch
---

Four audit fixes in the self-update channel, the legacy database migration, Shelley transcripts and the Claude turn queue.

The self-update channel now notices when the `pnpm local` supervisor goes away: the supervisor status is cleared, and check/apply answer the same 409 as an unsupervised server instead of a silent no-op 202 while the owner's update button appears to work.

The one-time Prisma-to-Drizzle migration is crash-safe. A crash between the renames used to leave no `app.db` at all, so the next boot silently created an empty database. The new database is now flushed to disk before the swap, and the next boot detects a half-done swap and either completes it or restores the pre-migration database before anything opens it.

A Shelley screenshot URL with a malformed percent escape (a file named `shot%zz.png`) no longer fails the whole transcript build for that conversation; the image degrades to its raw path. Image asset refs whose ids grow past four digits keep loading, matching what the producer mints in long conversations.

A turn whose Claude process failed to start is failed with that error instead of staying in the session's queue and being replayed to the next process, which could re-run the turn's actions a second time.
