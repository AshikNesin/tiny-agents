# No release for the kit packages: groot 3.2.1 sync

This branch syncs groot 3.2.1. The changes under `packages/*` and `.groot/` are
upstream's, and the kit packages adopt upstream's versions and changelogs
(`@groot/core` 2.2.0, `@groot/jobs` 3.0.0, `@groot/shell` 3.0.0, `@groot/ui`
1.3.0) instead of bumping past them, so later version-bump syncs merge
cleanly. The user-facing notes are in `.changeset/groot-sync-3-2-1.md`, which
releases the app package.
