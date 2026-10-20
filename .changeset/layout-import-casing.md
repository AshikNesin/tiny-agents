---
"@groot/jobs": patch
---

Import `PageLayout`/`Section` from their own files instead of the `components/layout` barrel. On case-insensitive filesystems (macOS) `@groot/shell/components/layout` resolved to `Layout.tsx`, which broke the dev server and typecheck.
