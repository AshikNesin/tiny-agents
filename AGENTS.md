# groot agent index

Use **pnpm** for everything: installs (`pnpm install`), scripts, and tests.
Do **not** call `vp` directly — it's wrapped by pnpm scripts (`pnpm check`,
`pnpm test`, `pnpm build`). Do not use npm or yarn.

This file is intentionally brief. Detailed guidance lives in `docs/` — start at
[`docs/README.md`](./docs/README.md).

## Non-negotiable rules

- **Packages never import from `apps/`.** Dependency direction is one-way:
  `@groot/ui` → `@groot/shell` → `apps/web/.../pages/`. Apps import packages,
  never the reverse.
- **Kit export removals are compatibility breaks.** Removing a public
  `@groot/ui` or `@groot/jobs` export needs a minor-release deprecation notice
  and lands no earlier than the next major. `pnpm typecheck:kit` compiles
  `tests/kit-consumers/consumer.tsx`, which imports every public subpath, so a
  removal breaks CI until the fixture and this policy are deliberately revised.
- **Schema changes are Prisma-only.** Never hand-write SQL or run `prisma db
  push`. Use `pnpm db:migrate:create` → `pnpm prisma migrate dev`, and edit
  **both** `schema.sqlite.prisma` and `schema.postgres.prisma` (a unit test
  enforces parity).
- **Only `packages/core/src/database/client.ts` may create the Prisma client.**
  Import the singleton from `@groot/core/database`.
- **The `DATABASE_URL` scheme is the engine switch** (`file:` → SQLite,
  `postgresql://` → Postgres). Switching engines requires regenerating the
  client (`pnpm prisma generate`) — the generated client embeds the datasource
  provider, and boot fails fast on a mismatch.
- **A change to a managed surface needs a changeset.** Edits under
  `packages/*/src`, `apps/web/prisma`, or `.groot/` must carry a changeset
  naming the affected package (`pnpm changeset`) or a reviewed no-release
  reason under `.changeset/no-release/` for docs-only or internal changes;
  `pnpm check:changesets` and CI enforce this, exempting the release bot.

- **Commits are the owner's, never Claude's.** Author and commit as
  `Ashik Nesin <github@ashiknesin.com>` (set `git config user.name` /
  `user.email` in the clone when the environment defaults to another
  identity). No `Co-Authored-By: Claude`, `Claude-Session` or other AI
  attribution trailers in commit messages, and no "Generated with Claude
  Code" footer or session link in PR descriptions. `.claude/settings.json`
  turns Claude Code's own attribution off; this rule covers everything else.

## Everyday commands

`pnpm dev` · `pnpm test` · `pnpm check` · `pnpm build` · `pnpm db:migrate` ·
`pnpm groot:sync` (apply boilerplate updates) · `pnpm groot:check` (dry run)

## Where to look

- Architecture & request flow: [`docs/guides/architecture.md`](./docs/guides/architecture.md)
- Commands & conventions: [`docs/guides/development.md`](./docs/guides/development.md)
- Migrations: [`docs/guides/database-migrations.md`](./docs/guides/database-migrations.md)
- Testing: [`docs/guides/testing.md`](./docs/guides/testing.md)
- Database engines (SQLite/Postgres matrix): [`docs/database-engines.md`](./docs/database-engines.md)
- Feature modules (reference): [`docs/features/todos.md`](./docs/features/todos.md)
- Design system rules: [`docs/features/dls.md`](./docs/features/dls.md)
- Architecture decisions & rationale: [`docs/adr/`](./docs/adr/README.md) — check here for _why_ before reversing a past decision
- Syncing downstream projects: [`docs/sync-guide.md`](./docs/sync-guide.md)
- Env vars & setup: [`docs/setup-guide.md`](./docs/setup-guide.md), [`.env.schema`](./.env.schema)
