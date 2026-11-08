---
"tiny-agents": minor
---

Synced groot 3.2.1 (`2a63753`), groot's deep-module pass over the kit.

- **Sessions:** one session module, `@groot/core/session` (`startSession`, `endSession`, `requireSession`). The protected API now uses `requireSession`; the old JWT and cookie helpers still work but are deprecated.
- **Rate limits:** limits count in a `RateLimitStore` the entry supplies, and the entry says who the client is. The Node entry passes `memoryRateLimitStore()` and `peerClientAddress` (the socket peer, or the hop a `TRUSTED_PROXIES` proxy vouches for, as before). Each app gets counters of its own.
- **Passkeys:** a challenge is consumed with one `DELETE … RETURNING` (`kv.take`), so two concurrent verifications of one challenge can no longer both pass. Housekeeping claims its slot with `kv.claim`.
- **Signed-in data:** the React Query cache resets on every sign-in, sign-out and expired session (`ShellQueryProvider`), so one account never sees another's cached data. tiny-agents keeps its one mutation retry.
- **Jobs:** one transitions module and one runner (`jobRunner`); the jobs list filter lives in `useJobsFilter()` and search runs on the server.
- **Shell and UI:** one hotkeys module (`@groot/ui/hotkeys`, nav shortcuts stand down behind dialogs), one mutation-feedback module (`useAction`), one storage browser (`useStorageBrowser`), ⌘K tabs list their own group, and adding an existing app setting no longer overwrites it. `@groot/ui/command` is deprecated.
- **Bodies:** a route owns its body limit with `routeBodyLimit()`, which can now word its own 413 (`onError`, AshikNesin/groot#167). The upload and Code upload routes use it, and tiny-agents no longer uses the deprecated `uploadPaths`.
