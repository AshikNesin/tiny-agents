# No release: remove @groot/ai

`packages/ai` (`@groot/ai`) is deleted. Nothing in tiny-agents imported it at
runtime: the agent talks to models through `packages/agent`. Removing the
package takes it out of the workspace, so no changeset can name it and no
version is released for it. Its tests, its doc page, its tsconfig and vitest
aliases and its kit-fixture imports go with it. `packages/ai/**` and
`tests/server/ai/**` are listed in `additional_exclusions` so `pnpm groot:sync`
never adds them back.

The `@groot/core` side of this branch (the Workers adapters) carries its own
changeset.
