---
"@tiny-agents/agent": patch
"@tiny-agents/code": patch
"@tiny-agents/claude-worker": patch
"tiny-agents": patch
---

Delete dead code, and fail CI on new dead code. `pnpm check:dead` runs knip
and fails on any unused file, export or unresolved import. Its message says
to add a file loaded by path to `entry` in `knip.json`, and otherwise to run
`scripts/codemods/remove-dead-code.ts`, which deletes unused files only with
`--remove-files`. Oxlint's `no-unused-vars` is now an error.

- `@tiny-agents/agent`, `@tiny-agents/code`, `@tiny-agents/claude-worker`:
  unused exports inside the packages lose `export` or are deleted, including
  the deprecated `createGatewayModels` alias and `ClaudeEngineError`. No
  export reachable from a package's `exports` map changes.
- `tiny-agents`: `pnpm db:generate` runs `drizzle-kit generate` alone.
  `apps/web/drizzle/index.ts`, which only the deleted Workers entry read, and
  `scripts/db-generate.ts`, which wrote it, are gone. The script is listed in
  `additional_exclusions`, so `pnpm groot:sync` never restores it.
