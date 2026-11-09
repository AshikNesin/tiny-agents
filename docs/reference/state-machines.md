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

| Machine     | File                                                                                      | Column                        | Written by                    |
| ----------- | ----------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------- |
| Routine run | [`routine-run.ts`](../../apps/web/src/shared/machines/routine-run.ts)                     | `routine_runs.status`         | `routines.runs.ts`            |
| Memory      | [`memory.ts`](../../apps/web/src/shared/machines/memory.ts)                               | `memories.status`             | `memories.ledger.ts`          |
| Extraction  | [`extraction.ts`](../../apps/web/src/shared/machines/extraction.ts)                       | `uploads.extract_status`      | `uploads.extraction.ts`       |
| Task        | [`task.ts`](../../apps/web/src/shared/machines/task.ts)                                   | `tasks.status`                | `task.service.ts`             |
| Hand-off    | [`handoff.ts`](../../apps/web/src/shared/machines/handoff.ts)                             | `code_handoffs.status`        | `code.store.ts`               |
| Job         | [`packages/jobs/src/lifecycle.ts`](../../packages/jobs/src/lifecycle.ts)                  | `jobs.state`                  | `packages/jobs` (groot-owned) |
| Routine     | [`routine.ts`](../../apps/web/src/shared/machines/routine.ts) (derived, `routineState()`) | `enabled`, `paused_reason`, … | `routines.arming.ts`          |

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
- **Hand-off.** `running → finished` is delivered once; a follow-up reopens
  a finished hand-off.
- **Routine.** Not stored as one column: `routineState()` reads `scheduled`,
  `struggling`, `auto_paused`, `done` or `paused` off the routine's fields,
  so the Routines page asks one question instead of combining four.

## Adding a machine

1. Add `apps/web/src/shared/machines/<name>.ts` with `defineMachine` and its
   graph in the header comment.
2. Type the column: `text("status").$type<YourStatus>()`. No migration: the
   SQL does not change, and every stray string write stops compiling.
3. Guard every write with `inArray(column, machine.sourcesOf(to))`.
4. Add the machine to `MACHINES` in `tests/server/api/state-machines.test.ts`
   (well-formed, every state reachable) and a row to the table above.

## Not machines, on purpose

Some status-like fields were looked at and left as they are:

| Field                                  | Why                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `providers.status`                     | A health probe's last result: any check may write any value, so there are no edges to guard. |
| `bot_messages` delivered / answered    | Two timestamps (pending → delivered → answered) owned by `bots.delivery.ts`.                 |
| `notification_log.status`              | `packages/core` is groot-owned: change it upstream, then `pnpm groot:sync`.                  |
| `shelley_handoffs.status`              | Legacy, read once by `copyShelleyTables()` into `code_handoffs`, never written.              |
| Staged uploads, connection-auth popups | In-memory UI flows inside one component or hook, with their own status unions.               |
