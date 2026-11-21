# Contributing

tiny-agents is a personal project, but fixes and ideas are welcome.

1. Open an issue first for anything larger than a small fix, so we can agree
   on the approach.
2. Set up the repo with the [Development](README.md#development) steps. Use
   pnpm, and run `pnpm install` so the git hooks (secret scan, staged lint)
   are installed.
3. Follow the rules in [AGENTS.md](AGENTS.md). Most are enforced by lint and
   by `pnpm verify:static`. A new test must fail before your change and pass
   after it; see [docs/guides/testing.md](docs/guides/testing.md).
4. If you change a published package, a migration or `.groot/`, add a
   changeset with `pnpm changeset` (or a `.no-release/` note explaining why
   none is needed). `pnpm check:changesets` tells you when one is missing.
5. Before you push, run `pnpm verify:static`, `pnpm test` and
   `pnpm test:client`, then open a pull request against `main`.
