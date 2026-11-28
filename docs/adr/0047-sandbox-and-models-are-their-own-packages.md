# ADR 0047: The sandbox and the model layer are their own packages

- Status: **accepted**
- Date: 2026-11-28

## Context

`packages/agent` held the runtime that drives pi-durable, the toolkits, the
sandbox VM layer (SSH, terminal tabs, the browser and computer sessions and
their VM setup scripts, the forwarding server) and the model layer (provider
accounts, roles, pi-ai calls). The sandbox and model code never touch
pi-durable and were together about 40% of the package. Keeping them apart
from the runtime was only a convention, and every importer that wanted an
SSH connection (the app routes, the Code drivers, the worker locator) pulled
the pi-durable boundary package with it.

## Decision

- **`@tiny-agents/sandbox`** (`packages/sandbox`) holds the sandbox VM layer.
  **`@tiny-agents/models`** (`packages/models`) holds the model layer.
- **Neither imports pi-durable nor `@tiny-agents/agent`.** Code they need
  from the runtime moves into them, or the caller passes it in.
- The browser, computer and sandbox toolkits stay in `@tiny-agents/agent`
  and drive the sandbox package; they reach pi-durable only through
  `ToolCall`.
- The symbols that moved stay re-exported from `@tiny-agents/agent` for
  outside importers, marked `@deprecated`, until a major removes them
  ([ADR 0033](0033-decisions-from-comments-agent.md)). Nothing in this repo
  imports them from there.

## Consequences

- Package dependencies make the layering real: `packages/sandbox` and
  `packages/models` cannot list `@tiny-agents/agent`.
- Lint R11 (`scripts/lint/boundaries.ts`) refuses the imports, with the
  same rule for `packages/code` ([ADR 0020](0020-native-code-harness.md)) and
  `packages/github` ([ADR 0022](0022-github-through-gh-or-a-token.md)).
- `pnpm check:old-modules` (`scripts/old-modules.json`) fails when code in
  this repo imports a deprecated re-export.

## Alternatives considered

- **One package with lint-only layering.** Cheaper, but importers would still
  pull the pi-durable boundary package to get an SSH connection.
