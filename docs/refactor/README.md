# Refactor tracker

The goal is that each mistake this repo kept repeating cannot be written
again. Each slice leaves `pnpm verify:static`, `pnpm test`, `pnpm test:client`
and `pnpm build` green.

| Slice | What it makes impossible                                   | Status |
| ----- | ---------------------------------------------------------- | ------ |
| 0     | A groot sync rewriting the child's gates and lint rules    | done   |
| 1     | A write route without an access tier                       | open   |
| 2     | A resource that is still loading read as a value           | open   |
| 3     | A client test that mocks the module it covers              | done   |
| 4     | Server data loaded outside `useResource`                   | done   |
| 5     | An unsent draft lost on remount                            | done   |
| 6     | A server timer or module state with no owner               | done   |
| 7     | A harness that declares a capability and omits its methods | done   |
| 8     | Stored JSON read with a cast; a helper written twice       | done   |
| 9     | A silent fallback                                          | done   |
| 10    | A feature mounted by hand in several lists                 | done   |
| 11    | Legacy ids and redirects kept beside their replacement     | done   |
| 12    | A source file that grows past the size limit               | done   |
| 13    | Prose rules for what a type or lint now enforces           | done   |

## groot

`scripts/gates.mjs` and `scripts/lint/` are listed in `additional_exclusions`
in `.groot/boilerplate-sync.json`: tiny-agents rewrote them, and a sync that
replaced `scripts/gates.mjs` once stopped 13 gates from running. A gate or
lint rule groot adds later is ported by hand. Files under
`packages/{core,jobs,shell,ui}` are never moved, renamed or deleted here.

## Debt left on purpose

- Server interval timers are unchanged. Each is tied to a connection or an
  injected clock, and `tests/server/fixtures/file-isolation.ts` already fails
  a test file that leaks one; a wrapper would not make a leak impossible.
- The browser navigation guard does not watch a tab whose `watch` call
  failed, so that tab's own page-initiated navigations continue unchecked
  (`packages/sandbox/src/navigation-guard.ts`). Agent actions on it re-watch
  and refuse. Closing this needs a decision on what a tab that cannot be
  watched may do.
- `apps/web/src/client/store/code.ts` still turns a failed `/code/status`
  into no harnesses, which hides Code; a characterization test pins it. It is
  logged now. The store needs a failed state.
- `PullView.ignored` and `TraceSummary` cannot say "unknown", so a failed
  owner or usage read shows as empty, with a warning in the log.
- A Shelley message's content blocks, a cached pull snapshot's inner arrays,
  the Auto-fix report and extracted upload content are each read as one
  object, so one bad element fails that value.
- `/code/settings/projects` still redirects to `/settings/projects`, because
  the Android app opens it (`NewCodeThreadScreen.kt`). Remove it once the app
  links to the new page.
- A GitHub pull snapshot fails whole on a malformed element on purpose: it
  drives Auto-fix and merge decisions.
