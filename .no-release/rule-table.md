# No release: AGENTS.md pairs each rule with its enforcer

`AGENTS.md` now lists each rule beside the command, lint rule or test that
fails when it breaks, and drops the prose those checks made redundant. Rules
that had no check get one: lint rules R7 (no transactions in packages), R8a (no
second database driver), R8b (only `bootstrap()` calls `setDb`) and R9 (only
the session guard throws `sessionInvalid()`), the
`pnpm check:migrations-immutable` gate, and a removed-export check in the kit
export guard. `pnpm db:generate` formats its output. The change touches
`AGENTS.md`, docs, `scripts/`, the root `package.json` scripts, one app file
and tests. No published package, migration or `.groot/` file changes.
