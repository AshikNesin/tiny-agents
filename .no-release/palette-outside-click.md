# No release: palette outside-click fix lives in groot

The change is one line in `packages/shell/src/components/CommandPalette.tsx`
(groot-owned synced copy): `dismissOnOutsideClick` on the palette's
`DialogContent`. Upstream fix: groot c7fe732 (changeset
`friction-audit-auth-ui.md`). App package unchanged; the regression test
(`tests/e2e/palette-close.spec.ts`) is covered by CI without a release.
