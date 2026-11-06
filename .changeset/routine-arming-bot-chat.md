---
"@groot/web": minor
---

One owner for a routine's armed state. `routines.arming.ts` (was
`routines.chain.ts`) is the only module that writes `enabled`, `nextRunAt`,
`pendingJobId`, `blockedStreak`, `pausedReason`, `conversationId` and the
create-time `sourceKey`; the service, runs, fire job and toolkit store ask
it for transitions (create, arm, disarm, advance, record blocked, clear
streak, claim conversation, move to bot, remove). Each transition is one
compare-and-set write, the job handle a write replaces is cancelled, and a
job queued for a write that lost is cancelled too.

Behaviour changes:

- A routine the agent creates is inserted with its `sourceKey` (and already
  armed) in one statement, so a replayed tool call can no longer create a
  duplicate routine after a crash or a race mid-create.
- Advancing the chain after a fire only moves it while the handle is still
  the one the fire loaded: an edit or pause that landed meanwhile wins, where
  before the fire could leave a second chain or re-arm a paused routine.
- The third blocked run in a row pauses the routine and records the reason in
  one write.
