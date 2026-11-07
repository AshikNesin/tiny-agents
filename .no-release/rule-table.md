# No release: AGENTS.md pairs each rule with its enforcer

`AGENTS.md` now lists each rule beside the command, lint rule or test that
fails when it breaks, and drops the prose those checks made redundant.
`docs/guides/development.md` stops repeating three of those rules. Docs only:
no published package, migration or `.groot/` file changes.
