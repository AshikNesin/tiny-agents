# No release: one static gate list for local runs and CI

`scripts/gates.mjs` now lists the static gates that `pnpm verify:static` and
the Tests workflow both run, and the git hooks skip gitleaks when it isn't
installed and typecheck before a push. The change touches `scripts/`,
`.github/workflows/`, `.vite-hooks/`, `package.json` scripts and a docs page.
No published package, migration or `.groot/` file changes.
