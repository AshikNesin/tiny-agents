# State machines

Every lifecycle a row moves through is written down as data: its states, the
states a row may start in, and the moves allowed from each state. The server's
writes, the client's types, the tests and this page all read the same graph,
so a new state or move is one edit and the compiler finds every reader.

## The shape

[`apps/web/src/shared/state-machine.ts`](../../apps/web/src/shared/state-machine.ts)
defines `defineMachine({ name, states, initial, transitions })`. A machine
gives you:

| Member          | Use it for                                                          |
| --------------- | ------------------------------------------------------------------- |
| `states`        | `z.enum(machine.states)`, the column's `$type`, display order       |
| `is(value)`     | Narrowing a stored string read back from the database               |
| `can(from, to)` | A pure check (UI enablement, tests)                                 |
| `sourcesOf(to)` | The compare-and-set guard of a write: `inArray(col, sourcesOf(to))` |
| `terminal`      | States with no way out, derived from the graph                      |

A guarded write moves only rows still in a state the graph allows the move
from. A racing writer, a late event or a stale worker changes nothing instead
of overwriting a settled row; the write's `returning()` tells the caller it
lost.

## The machines

| Machine       | File                                                                                      | Column                           | Written by                    |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------- |
| Routine run   | [`routine-run.ts`](../../apps/web/src/shared/machines/routine-run.ts)                     | `routine_runs.status`            | `routines.runs.ts`            |
| Memory        | [`memory.ts`](../../apps/web/src/shared/machines/memory.ts)                               | `memories.status`                | `memories.ledger.ts`          |
| Extraction    | [`extraction.ts`](../../apps/web/src/shared/machines/extraction.ts)                       | `uploads.extract_status`         | `uploads.extraction.ts`       |
| Task          | [`task.ts`](../../apps/web/src/shared/machines/task.ts)                                   | `tasks.status`                   | `tasks.service.ts`            |
| Hand-off      | [`handoff.ts`](../../apps/web/src/shared/machines/handoff.ts)                             | `code_handoffs.status`           | `code.store.ts`               |
| Auto-fix      | [`autofix.ts`](../../apps/web/src/shared/machines/autofix.ts)                             | `code_pull_requests.loop_status` | `code.pulls.store.ts`         |
| Auto-fix pass | [`autofix-pass.ts`](../../apps/web/src/shared/machines/autofix-pass.ts)                   | `code_autofix_passes.status`     | `code.pulls.store.ts`         |
| Code run      | [`run.ts`](../../apps/web/src/shared/machines/run.ts)                                     | `code_runs.status`               | `code.runs.ts`                |
| Push device   | [`push-subscription.ts`](../../apps/web/src/shared/machines/push-subscription.ts)         | `push_subscriptions.status`      | `push.store.ts`               |
| Job           | [`packages/jobs/src/lifecycle.ts`](../../packages/jobs/src/lifecycle.ts)                  | `jobs.state`                     | `packages/jobs` (groot-owned) |
| Routine       | [`routine.ts`](../../apps/web/src/shared/machines/routine.ts) (derived, `routineState()`) | `enabled`, `paused_reason`, …    | `routines.arming.ts`          |

Each machine file draws its graph in its header comment. The rules that ride
on the edges:

- **Routine run.** Only `awaiting` has a way out. The resolver's settle is
  guarded, so a run is resolved, carded and pushed once, even when the idle
  listener and the boot sweep race, and a run cancelled by a move to another
  bot is never overwritten by a late reply.
- **Memory.** Restore brings back `superseded`, `archived` and `expired`
  rows; a tombstone (`deleted`) comes back only when the owner adds the same
  text again on the Memory page.
- **Extraction.** A worker settles a row only while it is `pending`.
- **Task.** Any status moves to any other. Entering `done` stamps
  `completedAt`, leaving it clears it, and completing a task that is already
  `done` keeps its first stamp.
- **Hand-off.** A start claims its row as `starting` before the harness
  makes the thread, so a replayed start never makes a second one;
  `starting → running` records the thread. `running → finished` writes the
  finish it owes the bot in the same transaction (`code_handoff_finishes`),
  sent until it lands and taken once. A follow-up reopens a finished
  hand-off before its message is sent.
- **Auto-fix.** A linked PR's loop (issue #297). Only `decide()` picks a
  move; `code.pulls.ts` applies it. `merged` is final; `off` comes back only
  when the owner switches Auto-fix on, and an owner's message moves
  `needs_input` and `paused` back to `watching`.
- **Auto-fix pass.** Claimed as `starting`, keyed by the PR's state, before
  the harness hears anything, so a second claim for the same state loses.
  `running → finished` happens once, whichever of the turn end and the next
  reconcile gets there first.
- **Code run.** One turn of a Code thread that the owner, a workflow or a
  bot started (ADR 0039). A run opens as `running`, and the hub closes it
  when the harness reports the turn ended. `stopping` is a stop the owner
  asked for that the harness has not confirmed yet. A thread's place in the
  list is not a machine: `threadStatus` in `shared/code-status.ts` derives
  it.
- **Push device.** A phone's Web Push registration. Five failed sends in a
  row move it to `failing`, a delivery moves it back, and a 404 or 410 from
  its push service revokes it. Registering the same endpoint again brings a
  revoked device back.
- **Routine.** Not stored as one column: `routineState()` reads `scheduled`,
  `struggling`, `auto_paused`, `done` or `paused` off the routine's fields,
  so the Routines page asks one question instead of combining four.

## Labels and tones

A status the UI shows has one label and one tone, set next to its machine:
the machine file exports `<machine>Labels: StatusLabels<Status>`, a record
with a `label` and a `tone` for every state. `StatusLabels` and the tones are
in [`apps/web/src/shared/machines/status-label.ts`](../../apps/web/src/shared/machines/status-label.ts),
and [`MachineStatusBadge`](../../apps/web/src/client/components/MachineStatusBadge.tsx)
renders a status from its record as a badge or, with `plain`, as text. A new
state does not compile until its record has it, so the UI never shows a raw
status string.

## Adding a machine

1. Add `apps/web/src/shared/machines/<name>.ts` with `defineMachine` and its
   graph in the header comment.
2. Type the column: `text("status").$type<YourStatus>()`. No migration: the
   SQL does not change, and every stray string write stops compiling.
3. Guard every write with `inArray(column, machine.sourcesOf(to))`.
4. Add the machine to `MACHINES` in `tests/server/api/state-machines.test.ts`
   (well-formed, every state reachable) and a row to the table above.
5. If the UI shows the status, export its labels and render them with
   `MachineStatusBadge`.

## Not machines, on purpose

Some status-like fields were looked at and left as they are:

| Field                                  | Why                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `providers.status`                     | A health probe's last result: any check may write any value, so there are no edges to guard. |
| `bot_messages` delivered / answered    | Two timestamps (pending → delivered → answered) owned by `bots.delivery.ts`.                 |
| `code_handoff_finishes.delivered_at`   | One timestamp (owed → delivered) owned by `code.watcher.ts`.                                 |
| `notification_log.status`              | `packages/core` is groot-owned: change it upstream, then `pnpm groot:sync`.                  |
| Staged uploads, connection-auth popups | In-memory UI flows inside one component or hook, with their own status unions.               |
