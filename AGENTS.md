# groot agent index

Use **pnpm** for everything: installs (`pnpm install`), scripts, and tests.
Do **not** call `vp` directly — it's wrapped by pnpm scripts (`pnpm check`,
`pnpm test`, `pnpm build`). Do not use npm or yarn.

This file is intentionally brief. Detailed guidance lives in `docs/` — start at
[`docs/README.md`](./docs/README.md).

## Non-negotiable rules

- **Packages never import from `apps/`.** Dependency direction is one-way:
  `@groot/ui` → `@groot/shell` → `apps/web/.../pages/` on the client,
  `@groot/core` → `@groot/jobs` → `apps/web/src/server/` on the server. Apps
  import packages, never the reverse.
- **Kit export removals are compatibility breaks.** Removing a public
  `@groot/ui` or `@groot/jobs` export needs a minor-release deprecation notice
  and lands no earlier than the next major. `pnpm typecheck:kit` compiles
  `tests/kit-consumers/consumer.tsx`, which imports every public subpath, so a
  removal breaks CI until the fixture and this policy are deliberately revised.
- **Schema changes are Drizzle-only.** Edit a `schema.ts`
  (`packages/core/src/database/schema.ts`, `packages/jobs/src/server/schema.ts`
  or `apps/web/src/server/db/schema.ts`), run `pnpm db:generate`, and commit
  the generated SQL in `apps/web/drizzle/`. Never hand-write a migration or
  edit one that has been applied; CI fails when schema and migrations disagree.
- **Only `bootstrap()` sets the database handle.** Import `db` from
  `@groot/core/database` (packages) or `apps/web/src/server/db` (app code);
  never construct a driver elsewhere (`openAppDatabase()` / `createAppDb()` are
  for the Node entry, scripts and the test setup).
- **Core stays runtime-neutral.** `packages/core/src` uses Web APIs
  (`crypto.subtle`, `fetch`, `TextEncoder`). The only `node:` imports allowed
  are in `database/node.ts` and `storage/node.ts`, plus `node:async_hooks` and
  `node:buffer` (available on Workers under `nodejs_compat`). Node-only wiring
  belongs in `apps/web/src/server/entry.node.ts`.
- **No database transactions in `packages/`.** Core and jobs stay
  driver-agnostic (D1 has none): single statements, `RETURNING`,
  compare-and-set updates, idempotent retries.
- **tiny-agents is Node only** (Chromium, ssh2 and the pi-durable store run
  in-process), so groot's Workers target is not used here. App code imports
  `db` from `apps/web/src/server/db`: the same connection, typed with the
  app schema, so relational queries (`db.query.bots.findMany({ with })`) and
  synchronous transactions (`db.transaction((tx) => …)`, no `await` inside)
  are available to `apps/` code.
- **The first boot on a pre-Drizzle database copies it.**
  `apps/web/src/server/db/legacy-copy.ts` detects the old Prisma layout,
  keeps the file as `<db>.prisma-backup-<time>` and copies every row into the
  new layout. Keep its table list in step with the schema when adding app
  tables that existed before the move.
- **A change to a managed surface needs a changeset.** Edits under
  `packages/*/src`, `packages/*/package.json`, `apps/web/drizzle`, or `.groot/`
  must carry a changeset naming the affected package (`pnpm changeset`) or a
  reviewed no-release reason under `.no-release/` for docs-only or
  internal changes; `pnpm check:changesets` and CI enforce this, exempting the
  release bot.

## Everyday commands

`pnpm dev` · `pnpm test` · `pnpm check` · `pnpm build` · `pnpm db:generate` ·
`pnpm db:migrate` · `pnpm groot:sync` (apply boilerplate updates) · `pnpm groot:check` (dry run)

## Where to look

- Architecture & request flow: [`docs/guides/architecture.md`](./docs/guides/architecture.md)
- Commands & conventions: [`docs/guides/development.md`](./docs/guides/development.md)
- Migrations (Drizzle, SQLite only): [`docs/guides/database-migrations.md`](./docs/guides/database-migrations.md)
- Testing: [`docs/guides/testing.md`](./docs/guides/testing.md)
- Deploying: [`docs/guides/deploy.md`](./docs/guides/deploy.md) (Node; tiny-agents does not use the Workers guide)
- Config (`config.ts`, `defineConfig()`): [`docs/config.md`](./docs/config.md)
- Feature modules (reference): [`docs/features/todos.md`](./docs/features/todos.md); jobs: [`docs/features/jobs.md`](./docs/features/jobs.md)
- Design system rules: [`docs/features/dls.md`](./docs/features/dls.md)
- Architecture decisions & rationale: [`docs/adr/`](./docs/adr/README.md) — check here for _why_ before reversing a past decision
- Syncing downstream projects: [`docs/sync-guide.md`](./docs/sync-guide.md)
- Env vars & setup: [`docs/setup-guide.md`](./docs/setup-guide.md), [`.env.example`](./.env.example), [`packages/core/src/env.ts`](./packages/core/src/env.ts) (core), [`apps/web/src/server/env.ts`](./apps/web/src/server/env.ts) (tiny-agents)
