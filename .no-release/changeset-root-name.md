# No release: changeset gate fixes

The changeset gate now reads the root package name from `package.json` and
counts only the changesets and no-release reasons the branch adds. The change
touches `scripts/`, its test and `docs/guides/sync.md`. App code, published
packages and migrations are unchanged.
