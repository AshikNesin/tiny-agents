# tiny-agents agent index

Use **pnpm** for everything, never npm, yarn or a bare `vp`. Run `pnpm install`
in each new worktree, or its git hooks never run. Pre-commit runs gitleaks and
staged lint, pre-push runs `pnpm typecheck`, and `pnpm verify:static` runs the
gates CI runs. Guides start at [`docs/README.md`](./docs/README.md).

## Rules and their enforcers

R1 to R8b are lint rules in `scripts/lint/boundaries.ts`, run by `pnpm check`.

| Rule                                                               | Enforcer                                          |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| Packages never import from `apps/`.                                | R1                                                |
| `packages/core/src` uses Web APIs, not `node:` modules.            | R2                                                |
| Read env through `appEnv()` or core `env`, never `process.env`.    | R3                                                |
| Import `cn` from `@groot/ui/lib/utils`.                            | R4                                                |
| Render breadcrumbs with `Breadcrumbs` from `@groot/ui/breadcrumb`. | R5a, R5b, R5c                                     |
| No unused file or export.                                          | `pnpm check:dead`                                 |
| Every path, link and `pnpm` script a doc names exists.             | `pnpm check:doc-refs`                             |
| UI colors come from design tokens.                                 | `pnpm check:tokens`                               |
| A new check is one line in `scripts/gates.mjs`.                    | `pnpm check:coverage`                             |
| Change a `schema.ts`, then commit `pnpm db:generate`'s SQL.        | Migrations gate in `scripts/gates.mjs`            |
| Never edit an applied migration.                                   | `pnpm check:migrations-immutable`                 |
| A managed-path change adds a changeset or `.no-release/` reason.   | `pnpm check:changesets`                           |
| Every public `@groot/ui` and `@groot/jobs` subpath stays exported. | `scripts/check-kit-exports.ts`                    |
| Remove a kit export only in a major, after a deprecation.          | Judgment past `pnpm typecheck:kit`                |
| No transactions in `packages/`; sync ones are fine in `apps/`.     | R7                                                |
| Only `bootstrap()` sets `db`; never open a driver.                 | R8a, R8b                                          |
| Test dates derive from `FIXED_NOW` in `tests/test-clock.ts`.       | `tests/server/setup.ts` freezes `Date`            |
| A page or route guests reach is in `GUEST_ACCESS`.                 | `tests/server/routes/guest-access.routes.test.ts` |
| Each kind of resource a bot owns is in `BOT_RESOURCES`.            | `tests/server/api/bot-resources.test.ts`          |
| Only the session guard throws `sessionInvalid()`.                  | `tests/server/api/auth.test.ts`                   |
| Turn each operator correction into a row here.                     | Judgment, see below                               |

An `apps/` transaction is a sync `db.transaction()` with no `await` inside. A
wrong password or passkey is a plain 401, so it never signs the owner out
(`tests/server/routes/vault.routes.test.ts`). Guest pages are also checked by
`tests/client/guest-access-nav.test.tsx`. No check covers a kit export that
`tests/kit-consumers/consumer.tsx` does not import, and groot f191f76 broke
downstream apps that way.

When the operator corrects an agent, fix the mistake and add its row. If the
row was already here with no enforcer, fix it higher (structure, type, lint,
test) in the same change. The breadcrumb `<li>` nesting was fixed twice (#76,
#172) before a lint made it fail.

## Where to look

[Architecture](./docs/guides/architecture.md) ·
[Development](./docs/guides/development.md) ·
[Migrations](./docs/guides/database-migrations.md) ·
[Testing](./docs/guides/testing.md) · [Config](./docs/reference/config.md) ·
[Routines, the reference feature](./docs/features/routines.md) ·
[Design system](./docs/features/dls.md) · [Decisions](./docs/adr/README.md),
read before reversing one · [groot sync](./docs/guides/sync.md)
