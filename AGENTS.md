# tiny-agents agent index

Use **pnpm**, never npm, yarn or a bare `vp`. Run `pnpm install` in each new
worktree, or its git hooks never run. Pre-commit runs gitleaks and staged lint,
and `pnpm verify:static` runs the gates CI runs. Guides start at
[`docs/README.md`](./docs/README.md).

## Rules and their enforcers

R1 to R10 are lint rules in `scripts/lint/boundaries.ts`, run by `pnpm check`.

| Rule                                                               | Enforcer                                          |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| Packages never import from `apps/`.                                | R1                                                |
| `packages/core/src` uses Web APIs, not `node:` modules.            | R2                                                |
| Read env through `appEnv()` or core `env`, never `process.env`.    | R3                                                |
| Import `cn` from `@groot/ui/lib/utils`.                            | R4                                                |
| Render breadcrumbs with `Breadcrumbs` from `@groot/ui/breadcrumb`. | R5a, R5b, R5c                                     |
| Code and every test under `tests/` typecheck.                      | `pnpm typecheck`, run by the pre-push hook        |
| No unused file or export.                                          | `pnpm check:dead`                                 |
| Every path, link and `pnpm` script a doc names exists.             | `pnpm check:doc-refs`                             |
| UI colors come from design tokens.                                 | `pnpm check:tokens`                               |
| UI copy has no em dash; a needed one is written `\u2014`.          | R10                                               |
| A new check is one line in `scripts/gates.mjs`.                    | `pnpm check:coverage`                             |
| Change a `schema.ts`, then commit `pnpm db:generate`'s SQL.        | Migrations gate in `scripts/gates.mjs`            |
| Never edit an applied migration.                                   | `pnpm check:migrations-immutable`                 |
| A managed-path change adds a changeset or `.no-release/` reason.   | `pnpm check:changesets`                           |
| Remove a kit export only in a major, after a deprecation.          | `scripts/check-kit-exports.ts`                    |
| `packages/agent` parses stored JSON with `durable-json.ts`.        | R6, R6b                                           |
| No transactions in `packages/`; sync ones are fine in `apps/`.     | R7                                                |
| Only `bootstrap()` sets `db`; never open a driver.                 | R8a, R8b                                          |
| Test dates derive from `FIXED_NOW` in `tests/test-clock.ts`.       | `tests/server/setup.ts` freezes `Date`            |
| A page or route guests reach is in `GUEST_ACCESS`.                 | `tests/server/routes/guest-access.routes.test.ts` |
| Each kind of resource a bot owns is in `BOT_RESOURCES`.            | `tests/server/api/bot-resources.test.ts`          |
| Only the session guard throws `sessionInvalid()`.                  | R9                                                |
| Server module state lives in the App root.                         | R12                                               |
| A status column is a typed machine; its writes guard on it.        | `tests/server/api/state-machines.test.ts`         |
| Verify journeys and recipes name real pages and settings sections. | `tests/client/verify-journey-routes.test.ts`      |
| Turn each operator correction into a row here.                     | Judgment, see below                               |

An `apps/` transaction is a sync `db.transaction()` with no `await` inside. Guest
pages are also checked by `tests/client/guest-access-nav.test.tsx`.

When the operator corrects an agent, fix the mistake and add its row. If the
row was already here with no enforcer, fix it higher (structure, type, lint,
test) in the same change.

## Where to look

[Architecture](./docs/guides/architecture.md) ·
[Development](./docs/guides/development.md) ·
[Migrations](./docs/guides/database-migrations.md) ·
[Testing](./docs/guides/testing.md) · [Config](./docs/reference/config.md) ·
[Routines, the reference feature](./docs/features/routines.md) ·
[Design system](./docs/features/dls.md) ·
[State machines](./docs/reference/state-machines.md) · [Decisions](./docs/adr/README.md),
read before reversing one · [groot sync](./docs/guides/sync.md)
