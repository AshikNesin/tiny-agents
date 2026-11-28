# ADR 0048: Server state lives in one App root

- Status: **accepted**
- Date: 2026-11-28

## Context

The server kept its long-lived services (the agent runtime, the sandbox
connections, the live sessions, the Code hub, the SSE streams and more) in
module-level variables spread over many files. Boot order was call order,
and tests swapped a service with one setter per module
(`setAgentRuntimeForTests` and the like) and reset each by hand, so a test
that forgot a reset leaked into the next file.

## Decision

- **One composition root.** `App` in `apps/web/src/server/app-root.ts` is the
  record of every service and every piece of mutable server state. Code reads
  it through `app()`.
- **No other module state in `apps/web/src/server`.** A new piece of state is
  a field on `App`. A constant lookup is a `ReadonlySet` or `ReadonlyMap`.
- **Tests swap services through the root**: `installAppForTests` puts fakes
  in, `resetAppForTests` empties it, so one reset covers everything.
- **Caches live there too.** Derived keys, the vault's status, the
  extraction queue, the image processor and the error reporter are `App`
  fields like the services. The `R12_ALLOWED` list that
  [ADR 0032](0032-decisions-from-comments-server-and-scripts.md) describes
  kept them out for a while; it is gone, and the rule has no exceptions.

## Consequences

- Lint R12 (`scripts/lint/repo-plugin.mjs`, scoped in
  `scripts/lint/boundaries.ts`) refuses any top-level `let`, and any
  top-level collection not declared `ReadonlySet` or `ReadonlyMap`, in
  `apps/web/src/server`.
- `pnpm check:old-modules` keeps the retired module singletons from coming
  back ([ADR 0050](0050-retired-modules-stay-gone.md)).
- The server's state is one place to read when a test leaks or a restart
  loses something.

## Alternatives considered

- **Keep an allowlist of real caches.** It saved a few `App` fields nobody
  swaps, but every entry was one more place a test could leak through, and
  each new one needed a review.
