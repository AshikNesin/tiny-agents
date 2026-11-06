---
"@tiny-agents/code": minor
"@groot/web": minor
---

One turn-outcome rule for every harness. `turnOutcome` and `turnAnswer`
(`@tiny-agents/code/server`) build what a thread's newest turn came to from
the rows the driver shows; Shelley and Claude Code use it for both
`outcome()` and `turn_ended`, which now carries that `outcome` instead of
`finalText`/`failed`. `lastAnswer` (shared and Shelley's own) is gone.

- The text is the newest turn's answer or error, always a chat-sized
  excerpt, and `failed` means that answer is an error, for both harnesses
  (Shelley's turn ends used to carry no failure and its full final response).
- A message after the newest turn end opens a new turn: with nothing
  answered yet the text is empty for both harnesses (Shelley used to report
  the previous turn's answer). A steer's turn keeps its answer from before
  the steer.
- `endedAt` is when the harness last wrote to the turn, on its own record,
  and is absent while the thread works.
- Claude Code reports a turn end once the worker is idle, so a steer the CLI
  ran as its own SDK turn no longer ends the hand-off early.

The test kit adds `turnOutcomeProblems(snapshot, outcome, ended)`.
`parseThreadId(id, legacyInstanceId)` resolves bare (pre-ADR 0011) ids, with
`LEGACY_INSTANCE_ID`; the app splits thread ids only with it, so hand-offs and
labels of bare Shelley ids resolve. The Code watcher takes the outcome from
the event and no longer re-reads the thread or re-cuts the text.
