# No release: AGENTS.md pairs each rule with its enforcer

`AGENTS.md` now lists each rule beside the command, lint rule or test that
fails when it breaks, and drops the prose those checks made redundant. Three
rules that had no check get one: lint rules R7 (no transactions in packages),
R8a (no second database driver) and R8b (only `bootstrap()` calls `setDb`), and
the `pnpm check:migrations-immutable` gate. The change touches `AGENTS.md`,
docs, `scripts/`, the root `package.json` scripts and tests. No published
package, migration or `.groot/` file changes.
