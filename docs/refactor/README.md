# Refactor tracker

The goal is that each mistake this repo kept repeating cannot be written
again. Each slice leaves `pnpm verify:static`, `pnpm test`, `pnpm test:client`
and `pnpm build` green.

| Slice | What it makes impossible                                   | Status |
| ----- | ---------------------------------------------------------- | ------ |
| 0     | A groot sync rewriting the child's gates and lint rules    | done   |
| 1     | A write route without an access tier                       | open   |
| 2     | A resource that is still loading read as a value           | open   |
| 3     | A client test that mocks the module it covers              | open   |
| 4     | Server data loaded outside `useResource`                   | open   |
| 5     | An unsent draft lost on remount                            | open   |
| 6     | A server timer or module state with no owner               | open   |
| 7     | A harness that declares a capability and omits its methods | open   |
| 8     | Stored JSON read with a cast; a helper written twice       | open   |
| 9     | A silent fallback                                          | open   |
| 10    | A feature mounted by hand in several lists                 | open   |
| 11    | Legacy ids and redirects kept beside their replacement     | open   |
| 12    | A source file that grows past the size limit               | open   |
| 13    | Prose rules for what a type or lint now enforces           | open   |

## groot

`scripts/gates.mjs` and `scripts/lint/` are listed in `additional_exclusions`
in `.groot/boilerplate-sync.json`: tiny-agents rewrote them, and a sync that
replaced `scripts/gates.mjs` once stopped 13 gates from running. A gate or
lint rule groot adds later is ported by hand. Files under
`packages/{core,jobs,shell,ui}` are never moved, renamed or deleted here.

## Debt left on purpose

Recorded as each slice closes.
