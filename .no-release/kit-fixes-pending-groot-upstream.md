# No release: groot-owned kit fixes made here first, to upstream to groot

This branch fixes production issues found in an end-to-end test pass, and a
few of the fixes live in groot-owned synced packages (`packages/shell`,
`packages/core`, `packages/ui`, `packages/jobs`): the login deep-link return
(#78), the optional Toaster props on `GrootUIProvider` (#81), loading Inter
from the app entry instead of the shell CSS (#82), static asset caching and
the SPA fallback for missing assets (#83), accessibility fixes on the
Jobs and Storage pages (#96), and theme-aware native scrollbars
(`color-scheme` plus a quiet `scrollbar-color` in the shell CSS). They are made here so
production gets them now and must be ported to groot (`pnpm groot:upstream`)
so the next `pnpm groot:sync` does not revert them. Tiny-agents releases only
the app package; the user-facing notes are in the app changesets.
