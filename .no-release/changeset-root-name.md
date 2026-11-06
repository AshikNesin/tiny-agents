# No release: changeset gate fixes

The changeset gate now reads the root package name from `package.json`,
counts only the changesets and no-release reasons the branch adds, and rejects
a changeset that names a package outside the workspace. The change touches
`scripts/`, its test, two guides and the groot-sync skill. App code, published
packages and migrations are unchanged.
