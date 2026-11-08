# No release for the kit packages: groot 2a63753 sync

This branch syncs AshikNesin/groot#167 (`routeBodyLimit(bytes, { onError })`).
The `packages/core` change is upstream's and ships in groot's own
`@groot/core` release; tiny-agents adopts that version on the next sync
instead of bumping past it. The app's notes are in
`.changeset/groot-sync-route-body-limits.md`.
