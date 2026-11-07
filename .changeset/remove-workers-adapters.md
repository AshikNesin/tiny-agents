---
"@groot/core": major
---

Remove the Cloudflare Workers adapters. tiny-agents runs on Node only, so
`@groot/core/database/d1` (`migrateD1`, `splitStatements`),
`@groot/core/storage/r2` and the `r2Storage` export of `@groot/core/storage`
are gone. Use `@groot/core/database/node` and `localStorage` from
`@groot/core/storage/node`. Both files are listed in `additional_exclusions`,
so `pnpm groot:sync` never restores them.
