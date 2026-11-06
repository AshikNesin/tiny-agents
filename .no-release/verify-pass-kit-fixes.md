# No release: groot-owned kit fixes from the verify-tiny-agents pass, to upstream

Bugs found by the verify-tiny-agents full pass that live in groot-owned
synced packages, fixed here first so production gets them now:

- `packages/shell`: `CommandPaletteDialog` takes `builtIns` (default `true`)
  and `Layout` passes it through as `commandBuiltIns`, so an app that builds
  its own Navigation, Theme and Account groups can drop the shell's copies
  (#166). Additive: existing callers are unchanged.
- `packages/core`: storage downloads of `text/*` without a charset are served
  as `charset=utf-8`, so UTF-8 files viewed inline are not decoded as
  windows-1252 (#168).
- `packages/shell` (Storage) and `packages/jobs` (JobDetail): the breadcrumb
  separator, an `<li>` itself, is a sibling of the items instead of nested in
  one (#172).

They must be ported to groot (`pnpm groot:upstream`) so the next
`pnpm groot:sync` does not revert them. Tiny-agents releases only the app
package; the user-facing notes are in `.changeset/verify-pass-bug-fixes.md`.
