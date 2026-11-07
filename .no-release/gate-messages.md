# No release: gates name their fix and the rule table stays in step with the lint rules

The kit export guard, the changeset gate and the applied-migrations gate
resolve their base through `scripts/lib/merge-base.mjs`, so a missing or
too-shallow base fails with one line naming the fetch. A new
`scripts/check-rule-table.ts` gate fails when `AGENTS.md`'s rule table and
`scripts/lint/boundaries.ts` name different rule ids. R9 now catches
`sessionInvalid` reached through a dynamic import and a hand-built
`SESSION_INVALID` 401; R7 flags only transactions on the database. Kit export
removal approvals are keyed by subpath and can expire. The change touches
`scripts/` and tests only. No published package, migration or `.groot/` file
changes.
