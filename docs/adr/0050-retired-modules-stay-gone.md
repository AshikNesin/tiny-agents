# ADR 0050: Retired modules stay gone; narrowed modules keep their names

- Status: **accepted**
- Date: 2026-11-28

## Context

The rewrite replaced several modules: the Claude plan's old transcript, the
bots runtime singletons, hand-copied client API types, the two drifted
browser and computer session managers and more. A deleted file or symbol
comes back easily, by a merge from an old branch or by an agent copying a
pattern it found in history.

Three modules were not deleted but narrowed: `bots.service.ts` became bot
CRUD and links only (the chat actions moved to `chats.service.ts`), and
`browser-sessions.ts` and `computer-sessions.ts` became thin
`LiveSessions` instances over `packages/sandbox/src/live-sessions.ts`. Their
names follow the routines layout (`<feature>.service.ts`) and the package's
subpath exports.

## Decision

- **A retired module stays gone.** `scripts/old-modules.json` lists the
  retired paths, symbols, module singletons and patterns, each with the path
  that replaced it.
- **A narrowed module keeps its name and stays narrow.** The list names each
  one with what it may and may not contain: no chat action in
  `bots.service.ts`, no session-manager logic outside `live-sessions.ts`.
  Renaming them would churn imports for nothing.

## Consequences

- `pnpm check:old-modules` (`scripts/check-old-modules.ts`) fails when a
  retired path exists or is imported, a retired symbol is declared, a retired
  singleton is back, a retired pattern matches, or a narrowed module grows
  back. `tests/server/checks/old-modules.test.ts` covers each case.
- Retiring another module is an entry in the list, in the same change that
  deletes it.
