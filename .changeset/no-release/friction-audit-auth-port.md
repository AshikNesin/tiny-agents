# No release: auth-UX fixes ported from groot

Login error mapping (`loginErrorDescription`), the logout toast in
`Layout`, and the dropdown submenu `sideOffset` live in `packages/shell`/
`packages/ui`, which are groot-owned synced copies. The upstream fixes
landed in groot (aba55a5, changeset `friction-audit-auth-ui.md`) and were
ported here without local divergence. Tiny-agents releases only the app
package; kit changes ride the next `pnpm groot:sync`.
