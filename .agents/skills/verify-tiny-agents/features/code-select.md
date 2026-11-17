# Code multi-select archive

On the Code page the owner can turn the thread list into checkboxes, pick several threads (or Select all), and archive them in one go, with a single Undo that brings them all back. In the Archived view the same bar restores many threads at once. A picked thread's subagents go along with it.

## Sub-features

- `select-toggle` button `Select threads` (shown when a harness archives) turns rows into checkboxes `Select <title>`; it becomes `Stop selecting`. Row Archive buttons hide.
- `select-bar` toolbar `Selected threads`: `Select threads` with nothing picked, then `N selected` (`+ M subagents` when subagents go along), `Select all` / `Clear`, and `Archive` (or `Restore` in Archived).
- `select-archive` Archive: toast `Archived N threads` with `Undo`; the rows leave the list; Select mode ends.
- `select-undo` one `Undo` restores every thread the batch moved.
- `select-restore` Archived view (footer `List options` → `Show archived`): Select all → `Restore`: toast `Restored N threads`; the rows return to Active.
- Not driven: subagent rows (shown ticked and disabled under a picked parent), covered by `tests/client/pages/code-list.test.tsx`.

## How to get to it (user POV)

- Sidebar navigation `Primary` → `Code`, then `List options` (footer) → `Select threads`.

## Driving it with ta-verify

Preconditions:

- `ta-verify up --shelley` (the journey requires `shelley`). Shelley runs on the host with its keyless `predictable` model.
- `setup:` a throwaway git repo `data/verify/<run>/select-<stamp>`, three threads started there through `POST /code/threads` (`echo: select-N-<stamp>`), renamed through the API to `sel-N-<stamp>` once idle. Cleanup deletes every thread in that directory, active and archived.

- **Select.** `/code` → `Select threads` → tick `Select sel-1-…` and `Select sel-2-…`: bar reads `2 selected`, `sel-3` stays unticked, no row `Archive` buttons.
- **Archive.** Bar `Archive` → `Archived 2 threads`; both rows gone, `sel-3` stays; API: archived view lists exactly the two.
- **Undo.** Toast `Undo` → API active list has all three, archived none; reload shows them.
- **Restore.** Archive the two again, the list footer's `Archived` (`code-archived-toggle`): only the two listed; `Select threads` → `Select all` → `2 selected` → `Restore` → `Restored 2 threads`; API: none archived. `Archived threads` (`code-archived-back`) → all three listed again.
- **Proof.** `ta-verify drive $S/journeys/code-select.mjs` → `selected`, `archived`, `undone`, `archived-view-selected`, `restored`.

## Gotchas

- Shelley titles a thread from its first reply, so the journey renames threads to known titles before it looks for rows.
- The thread index lags an archive call by a moment: poll the API, never read it once.
- The list's footer (`Archived`, `Settings`) hides while Select mode is on; end Select mode before switching views. Select all picks the rows of open (unfolded) groups only.
- A host Shelley build that embeds a UI source directory refuses to serve when those sources are newer than its build ("Please run 'make serve'"). Point `TA_VERIFY_SHELLEY_BIN` at a binary that serves, and keep its `HOME` short: the Unix socket path must stay under 108 bytes.
