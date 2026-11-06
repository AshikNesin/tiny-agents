# No release: boundary lint rules

Oxlint now enforces the dependency rules in AGENTS.md, and pnpm stops a script
that runs on a stale install. The change touches `vite.config.ts`,
`pnpm-workspace.yaml`, `scripts/`, a test, and 21 app files whose `cn` import
moves from `@groot/shell/lib/utils` to `@groot/ui/lib/utils`, the same
function. No published package, migration or `.groot/` file changes.
