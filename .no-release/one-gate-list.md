# No release: one static gate list for local runs and CI

`scripts/gates.mjs` now lists the static gates that `pnpm verify:static` and
the Tests workflow both run. The git hooks skip gitleaks when it isn't
installed, run each worktree's own hook scripts and typecheck before a push,
and CI scans each event's commits for secrets. The change touches `scripts/`,
`.github/workflows/`, `.vite-hooks/`, `package.json` scripts and docs pages.
No published package, migration or `.groot/` file changes.
