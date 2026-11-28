# ADR 0052: Code thread ids always carry their instance

- Status: **accepted** (supersedes the bare-id rule of
  [0011](0011-code-harness-adapters.md))
- Date: 2026-11-28

## Context

ADR 0011 made Code thread ids `<instance>:<native>` and read a bare id, one
from before Code had more than one coding agent, as a Shelley conversation.
Old chat cards, pushes and `/code/<id>` links carried such ids. Every place
that split a thread id needed to know that default
(`LEGACY_INSTANCE_ID` in `@tiny-agents/code`), and an id the app did not know
was sent to Shelley as a conversation name.

## Decision

- **A thread id always names its instance.** `parseThreadId`
  (`packages/code/src/contracts/ids.ts`) refuses an id with no instance in
  front; `LEGACY_INSTANCE_ID` is removed.
- **Saved bare ids were prefixed once.** Migration
  `apps/web/drizzle/0040_code_prefix_bare_thread_ids.sql` gives each
  hand-off, pull request, checkpoint, viewed mark and review comment still
  saved under a bare id its Shelley thread, so those keep working.
- Everything else in ADR 0011 stands.

## Consequences

- A thread opened by an id the app does not know answers "not found"
  instead of asking Shelley for a conversation of that name.
- An old link or push that still holds a bare id no longer opens its thread.
