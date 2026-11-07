# No release: typecheck the tests

`pnpm typecheck` now compiles `tests/server`, `tests/client` and `tests/e2e`.
The change touches the root and `apps/web` tsconfigs, a new
`tests/e2e/tsconfig.json`, root dev dependencies (`@types/ws`,
`@types/micromatch`), `scripts/`, docs, and tests whose type errors it
surfaced. No published package, migration or `.groot/` file changes.
