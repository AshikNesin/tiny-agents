# No release: boundary lint rules

Oxlint now enforces the dependency rules in AGENTS.md. The change touches
`vite.config.ts`, `scripts/`, a test, and 21 app files whose `cn` import
moves from `@groot/shell/lib/utils` to `@groot/ui/lib/utils`, the same
function. No published package, migration or `.groot/` file changes.
