# tiny-agents agent index

Use **pnpm**, never npm, yarn or a bare `vp`. Run `pnpm install` in each new
worktree, or its git hooks never run. Pre-commit runs gitleaks and staged lint,
and `pnpm verify:static` runs the gates CI runs. Guides start at
[`docs/README.md`](./docs/README.md).

## Rules and their enforcers

R1 to R24 are lint rules in `scripts/lint/boundaries.ts`, run by `pnpm check`.

| Rule                                                                                                                                                                                                                                 | Enforcer                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Packages never import from `apps/`.                                                                                                                                                                                                  | R1                                                                               |
| `packages/models`, `packages/sandbox`, `packages/github` and `packages/code` import neither pi-durable nor `packages/agent`; `packages/github` takes an exec port, not `packages/sandbox`.                                           | R11                                                                              |
| `packages/core/src` uses Web APIs, not `node:` modules.                                                                                                                                                                              | R2                                                                               |
| Read env through `appEnv()` or core `env`, never `process.env`.                                                                                                                                                                      | R3                                                                               |
| Import `cn` from `@groot/ui/lib/utils`.                                                                                                                                                                                              | R4                                                                               |
| UI primitives (Base UI, Radix, cmdk) are imported only in `packages/ui`; pages use `@groot/ui`. `@shadcn/react` is allowed anywhere.                                                                                                 | R18                                                                              |
| Render breadcrumbs with `Breadcrumbs` from `@groot/ui/breadcrumb`.                                                                                                                                                                   | R5a, R5b, R5c                                                                    |
| Code and every test under `tests/` typecheck.                                                                                                                                                                                        | `pnpm typecheck`, run by the pre-push hook                                       |
| No source file in `apps/web/src` or a tiny-agents package is over 800 lines.                                                                                                                                                         | R24                                                                              |
| No function is written twice; one every package needs lives in `packages/std`.                                                                                                                                                       | `pnpm check:duplicates`                                                          |
| No unused file or export.                                                                                                                                                                                                            | `pnpm check:dead`                                                                |
| A module the rewrite retired stays gone, and a narrowed one narrow.                                                                                                                                                                  | `pnpm check:old-modules`                                                         |
| Every path, link and `pnpm` script a doc names exists.                                                                                                                                                                               | `pnpm check:doc-refs`                                                            |
| UI colors come from design tokens.                                                                                                                                                                                                   | `pnpm check:tokens`                                                              |
| UI copy has no em dash; a needed one is written `\u2014`.                                                                                                                                                                            | R10                                                                              |
| A new check is one line in `scripts/gates.mjs`, and every gate runs in one CI job (no `job` means `gates`).                                                                                                                          | `pnpm check:coverage`, `tests/server/checks/workflow-coverage.test.ts`           |
| Change a `schema.ts`, then commit `pnpm db:generate`'s SQL.                                                                                                                                                                          | Migrations gate in `scripts/gates.mjs`                                           |
| Never edit an applied migration.                                                                                                                                                                                                     | `pnpm check:migrations-immutable`                                                |
| A managed-path change adds a changeset or `.no-release/` reason.                                                                                                                                                                     | `pnpm check:changesets`                                                          |
| Remove a kit export only in a major, after a deprecation.                                                                                                                                                                            | `scripts/check-kit-exports.ts`                                                   |
| Code features work for every harness: shared git and diff logic lives in `packages/git`; only `code.registry.ts` names a harness's package.                                                                                          | R14                                                                              |
| JSON text is read with `parseJson` or `parseEach` from `@tiny-agents/std` and a schema, never `JSON.parse(x) as T`.                                                                                                                  | R22                                                                              |
| `packages/agent` parses stored JSON with `durable-json.ts`.                                                                                                                                                                          | R6, R6b                                                                          |
| No transactions in `packages/`; sync ones are fine in `apps/`.                                                                                                                                                                       | R7                                                                               |
| Never read a row, `await`, then insert into its table: use `onConflictDoNothing()` on a unique index, or one sync `db.transaction()` in `apps/`.                                                                                     | R19                                                                              |
| Only `bootstrap()` sets `db`; never open a driver.                                                                                                                                                                                   | R8a, R8b                                                                         |
| Test dates derive from `FIXED_NOW` in `tests/test-clock.ts`.                                                                                                                                                                         | `tests/server/setup.ts` freezes `Date`                                           |
| A server test file leaves nothing for the next one: env and globals through `vi.stubEnv`/`vi.stubGlobal`, servers, sockets, children and due timers closed.                                                                          | `tests/server/fixtures/file-isolation.ts`, run after every file                  |
| A branch merges with `origin/main` without a conflict, so no two branches take one migration number or file.                                                                                                                         | `pnpm check:merge-main`, run by pre-push                                         |
| PRs run the tests their diff reaches; pushes to `main` and `next` and the merge queue run all of them. `CI (1/2)` and `CI (2/2)` are the required checks.                                                                            | `scripts/lib/workflow-coverage.ts`, `tests/server/checks/test-selection.test.ts` |
| A page or route guests reach is in `GUEST_ACCESS`.                                                                                                                                                                                   | `tests/server/routes/guest-access.routes.test.ts`                                |
| A write route is declared with `routes()` (`apps/web/src/server/api/routes.ts`), which takes its tier (`public`, `signedIn`, `stepUp`); a kit router is mounted with `kitRoutes()`. `pnpm routes` lists them.                        | `pnpm typecheck`, R20, `tests/server/routes/route-access.routes.test.ts`         |
| A folder under `apps/web/src/server/api/` is one feature: its routes are mounted in `FEATURES`, and a file named for another feature lives in that feature's folder.                                                                 | `tests/server/checks/feature-shape.test.ts`                                      |
| Each kind of resource a bot owns is in `BOT_RESOURCES`.                                                                                                                                                                              | `tests/server/api/bot-resources.test.ts`                                         |
| Only the session guard throws `sessionInvalid()`.                                                                                                                                                                                    | R9                                                                               |
| Server module state lives in the App root.                                                                                                                                                                                           | R12                                                                              |
| Client request/response data loads through `useResource` (`apps/web/src/client/queries/resource.ts`), never a fetch, `xxxApi.` call or imported `load…` helper in `useEffect`; a poll is its `refetchInterval`, never `setInterval`. | R15, R23                                                                         |
| Code carries no comments, and a lint directive no `-- reason`; a decision goes in an ADR. Old comments stay in `scripts/lint/comment-baseline.json` until deleted.                                                                   | R16, `pnpm check:comments`                                                       |
| Handle, rethrow, or catch into a function named for why; never `catch {}` or `.catch(() => x)`. The kit packages groot owns are out of scope.                                                                                        | R17                                                                              |
| A doc, comment or changeset names the code that owns a list or number, never a copy of it.                                                                                                                                           | Judgment                                                                         |
| API wire types live in `apps/web/src/shared/api/`; a client `*-api.ts` declares none.                                                                                                                                                | R13                                                                              |
| A status column is a typed machine; its writes guard on it.                                                                                                                                                                          | `tests/server/api/state-machines.test.ts`                                        |
| An input that turns a safety check on (the gate's `run`, a service's `viewer`) is required, never optional.                                                                                                                          | `pnpm typecheck`                                                                 |
| Verify journeys and recipes name real pages and settings sections.                                                                                                                                                                   | `tests/client/verify-journey-routes.test.ts`                                     |
| A change under `mobile/android/` bumps `VERSION_CODE` (and `VERSION_NAME`) in `mobile/android/version.properties`, with a `mobile/CHANGELOG.md` entry, so CI releases the app.                                                       | `pnpm check:merge-main`, run by pre-push                                         |
| A client test fakes the network with `fakeApi()` (`tests/client/fakes/api.ts`) and renders the real modules; it never mocks or spies on a first-party module.                                                                        | R21                                                                              |
| A new test fails before the change and asserts behavior, not a mock of the code it covers.                                                                                                                                           | Judgment, see Testing                                                            |
| Turn each operator correction into a row here.                                                                                                                                                                                       | Judgment, see below                                                              |

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

## Testing

A test earns its place by failing before the change and passing after it.
Commands, layout, and helpers are in [Testing](./docs/guides/testing.md). The
bar is the Tests section of
[Expo's AGENTS.md](https://github.com/expo/expo/blob/main/AGENTS.md) and the
same one in Matt Pocock's TDD notes: a test that already passes, or that
mocks the code it claims to cover, does not count.

- Write the test first. Watch it fail for the reason you expect. Then change
  the code until it passes.
- Add a test only for behavior this change introduces or fixes. Do not add a
  test that already passes on the code you are about to change. A regression
  test that passes before the fix does not catch the bug.
- Call the real function, route, or component. Assert what a caller can
  observe: the return value, the saved row, the HTTP status and body, or the
  text on the screen.
- Mock only a boundary this process does not own: the network, the clock, a
  third-party SDK, or a subprocess. The database is the real in-memory
  SQLite database. When production code already takes a port as an argument
  (a model caller, a notifier), pass a fake for that port. Assert the
  decision the real code made, including the value it returns or saves.
- An expected value is a literal, a worked example, or the spec. Do not
  recompute it the way the code does. `expect(add(2, 2)).toBe(2 + 2)` passes
  by construction.
- Do not mock the function you changed, or the module that contains it, and
  then assert that the mock was called. That passes whether the fix works or
  not.
- Do not make `toHaveBeenCalled` the only assertion when the outcome is
  observable.
- Do not add a snapshot or a large fixture for a one-line fix.

Server tests run with `pnpm test` (Vitest, the Hono app in-process). Client
tests run with `pnpm test:client`. `pnpm test:all` runs both. Use
`pnpm test:e2e` for a journey those two cannot see. CI does not run
Playwright.

Dates come from `FIXED_NOW` in `tests/test-clock.ts`. Do not call
`vi.useRealTimers()` to leave that frozen clock.
