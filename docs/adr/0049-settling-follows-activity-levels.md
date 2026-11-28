# ADR 0049: Settling follows activity levels, not a once-per-turn edge

- Status: **accepted**
- Date: 2026-11-28

## Context

When a reply finishes, the settled pipeline (`apps/web/src/server/api/bots/bots.settled.ts`)
relays answers between bots, records routine results, updates the sidebar,
sends pushes and counts turns toward memory capture. It settles on every
change to the runtime's activity that reads idle, not on one "turn settled"
event per turn.

The two differ only when a wait count changes after the idle edge. A plain
turn emits one busy and one idle change, on both engines. A Claude plan turn
stopped while a call waits for approval emits idle with the approval still
counted, then idle again, so it settles twice: the memory-capture counter
moves twice and the list is rewritten twice. The owner chose to keep that
behavior.

## Decision

- **Settling stays level-triggered.** The pipeline settles on each idle
  activity change, including one where only a wait count changed.
- **No `TurnSettled` edge.** A real once-per-turn edge would change the
  double settle above; an edge that also fires on those changes would rename
  today's behavior and gain nothing.
- If the double settle is ever to be fixed, that fix is the switch to an
  edge, made as its own change.

## Consequences

- `tests/server/characterization/c16.test.ts` pins both cases: one idle
  change for a plain turn, two for a stopped Claude plan turn with an
  approval waiting.
- A stopped Claude plan turn with an approval waiting reaches the memory
  capture limit in half the turns.
