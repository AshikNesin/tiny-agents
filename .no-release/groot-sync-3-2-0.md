# No release for the kit packages: groot 3.2.0 sync

This branch syncs groot 3.2.0. The changes under `packages/*` and `.groot/` are
upstream's, and the kit packages adopt upstream's versions and changelogs
(`@groot/core` 2.1.1, `@groot/jobs` 2.0.2, `@groot/shell` 2.2.0, `@groot/ui`
1.2.0) instead of bumping past them, so later version-bump syncs merge
cleanly. Bumping them here would put tiny-agents' kit versions ahead of
groot's again, the cause of this sync's CHANGELOG and package.json conflicts.
The user-facing notes are in `.changeset/groot-sync-3-2-0.md`, which releases
the app package.
