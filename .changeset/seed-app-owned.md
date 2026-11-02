---
---

sync: `scripts/seed.ts` is app-owned

The seed imports the app's own schema (the template seeds todos), so a synced
copy crashed `pnpm dev` and `db:seed` in any child without those tables. It is
now a skip pattern: children keep and edit their own seed, `groot:sync` no
longer overwrites it. Children that already listed it in
`additional_exclusions` can drop that entry.
