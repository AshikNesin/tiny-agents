# ADR 0051: API wire types live once, in `shared/api`

- Status: **accepted**
- Date: 2026-11-28

## Context

The client kept its own copies of the API's request and response types in
`client/lib/*-api.ts`. Several had drifted from what the server sends: a
field the copy called a `string` could be `null`, and fields the server sent
were missing. Nothing failed when they drifted, because the server and the
client typechecked against different declarations.

## Decision

- **One declaration per wire type**, in `apps/web/src/shared/api/<area>.ts`.
  The server's handlers and the client import it from there.
- **A `…Data` type is what a handler hands to `ok()`**, with dates as `Date`.
  The plain name is its `Jsonified` form (`apps/web/src/shared/json.ts`),
  which the client reads.
- A handler or service is annotated with its response type, so a server
  change that breaks the client fails the typecheck.
- Request bodies stay validated by the routes' zod schemas.
- Where a copy disagreed with the server, the shared type follows the server.

## Consequences

- Lint R13 (`scripts/lint/repo-plugin.mjs`) refuses a type declared in a
  client `*-api.ts`.
- `tests/server/api/wire-types.test.ts` fails the typecheck when a body type
  is one its schema would not accept.
