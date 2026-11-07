# No release: run server test files in parallel

The server suite now runs its files in parallel, two workers per core, since
each file already gets its own in-memory database. The kit-export and
typecheck-coverage check tests plant their probe files in a scratch copy of the
repo instead of the real tree, and two spawn helpers ignore EPIPE on stdin.
The change touches only `vitest.config.server.ts` and `tests/`. App code,
published packages and migrations are unchanged.
