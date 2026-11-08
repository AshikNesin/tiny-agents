---
"tiny-agents": minor
---

Synced groot 3.2.0 (`e77d641`), which brings back the kit fixes tiny-agents sent upstream plus groot's follow-up work.

- **Scheduled jobs:** croner 11, so a job schedule with `?` in the day-of-month or day-of-week field (`0 0 ? * MON`) runs on the days it names instead of every day.
- **Server:** `@hono/node-server` 2. Static files are served for GET and HEAD only, and paths with a raw backslash or a `%` left after decoding are refused.
- **Dependencies:** TypeScript 7 (the native compiler; the AST check scripts use `@typescript/typescript6`), `@hookform/resolvers` 7, Vite+ 1.5 with Vitest 5.1, jsdom 31, hono 4.13 and `@types/better-sqlite3` 9.
- **Checks:** a `pnpm check:pnpm-policy` gate keeps the supply-chain settings in `pnpm-workspace.yaml`, the migrations check ignores the generated drizzle index, and CI's gitleaks download fallback has a token.
- **Kept local:** tiny-agents' R6/R6b lint rules, its env and driver exemptions, its test setup and aliases, and its Node-only deletions. groot's `verify-groot` skill is excluded from sync (it drives groot's demo app).
