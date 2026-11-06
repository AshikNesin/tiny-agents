# Jobs admin

On `/jobs` the owner also has the queue's bulk and maintenance tools: Retry a failed job, select several rows and re-run them together, schedule a job type on a cron (listed in a Scheduled jobs panel where it can be edited and cancelled), and purge every job in one state. Each destructive or bulk action asks for confirmation and reports its outcome in a toast.

## Sub-features

- `jobs-retry` a failed (or cancelled) job's detail page offers `Retry`: toast `Job has been queued for retry`; the same job runs again (new start time).
- `jobs-bulk-rerun` row checkboxes `Select job <name> (<short>)` (and `Select all`) show `Rerun <n>`; alertdialog `Re-run <n> selected jobs?` → `Re-run`: toast `Successfully triggered re-run for <n> of <n> jobs.`, one new job per selected row with the same payload, originals unchanged, selection cleared.
- `jobs-schedule` header `Schedule` → dialog `Schedule Recurring Job`: `Job type` picker (job types seen in the queue plus registered handlers), `Cron expression`, `Job data (JSON)` → `Schedule Job`: toast `Job has been scheduled`.
- `jobs-scheduled-panel` section `Scheduled jobs` (`<n> total`) lists name, cron, timezone (`Server time`) and data, with `Edit schedule <name>` (dialog `Edit Scheduled Job`, name locked, `Save Changes`, toast `Scheduled job has been updated`) and `Cancel schedule <name>` (alertdialog `Cancel scheduled job "<name>"?` → `Cancel schedule`, toast `Scheduled job has been cancelled`). Hidden when there are no schedules.
- `jobs-purge` a state-filtered list offers `Purge <State>`: alertdialog `Purge all <State> jobs?` → `Purge`: toast `Purged <n> <State> jobs`, empty state `No <state> jobs`.

## How to get to it (user POV)

- Only by URL: `/jobs` (not in the sidebar, account menu or ⌘K). A state: `/jobs?state=failed` or the state tabs/tiles.
- A job: its row link `View details for job <name> (<short>)` → `/jobs/<jobId>`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in. Setup (API): two `routine-fire` jobs with `{ verify: <stamp>, n: 1|2 }` and `retryLimit: 0` (no `routineId`, so they fail at once), and one job named `verify-sched-<stamp>` (no handler: it stays Created, and its name becomes a job type the Schedule dialog offers).

- **Retry.** `/jobs?state=failed` → row link of job A → `/jobs/<id>`, `Error` card, `Retry`. Click it: `POST /api/v1/jobs/<id>/retry` 200, toast; the API shows the job `failed` again with a later `startedAt`; after a reload the page still offers `Retry`.
- **Bulk re-run.** Back on the Failed list, tick A and B, `Rerun 2` → confirm → `POST /api/v1/jobs/bulk-rerun` answers both ids `success: true` with `newJobId`s; toast; `Rerun …` gone. The copies fail too (same payloads `n` 1 and 2); A and B stay `failed`; all four rows listed.
- **Schedule.** `/jobs` → `Schedule` → payload `{"verify": "<stamp>"}` (CodeMirror, `keyboard.insertText`), `Cron expression` `0 3 1 1 *`, `Job type` → menuitem `verify-sched-<stamp>` → `Schedule Job`: `POST /api/v1/jobs/schedule` 201, toast, `GET /api/v1/jobs/schedule` has it. Reload: panel `Scheduled jobs` shows the cron and data.
- **Edit + cancel.** `Edit schedule verify-sched-<stamp>`: `Job type` disabled, cron prefilled → `0 4 1 1 *` → `Save Changes`; the API has one row with the new cron. `Cancel schedule …` → confirm → `DELETE /api/v1/jobs/schedule/<name>` 200, toast, gone from panel and API; the parked job is still `created`.
- **Purge.** Guard: every job in `GET /api/v1/jobs?state=failed` carries this drive's stamp (exactly A, B and the two copies); snapshot the ids of all non-failed jobs. `/jobs?state=failed` → `Purge Failed` → confirm → `DELETE /api/v1/jobs/state/failed` → `count: 4`, toast `Purged 4 Failed jobs`, `No failed jobs`; the four are 404; every snapshotted job (including the parked one) still exists.
- **Proof.** `ta-verify drive $S/journeys/jobs-admin.mjs` → `jobs-admin/failed-detail`, `retried`, `bulk-rerun-confirm`, `bulk-rerun-done`, `scheduled-panel`, `schedule-cancelled`, `purge-confirm`, `purged`. Cleanup deletes every job with the stamp or the parked name and the schedule if a step failed first.

## Gotchas

- Purge deletes **every** job in that state on the instance, not only yours. The journey refuses (guard step) when the Failed list holds a job it did not create; never purge `created`/`completed` on a shared run.
- Schedules are keyed by job name (one per name, saving again replaces it). Use a stamped job type of your own so a real schedule is never replaced or cancelled, and a cron that cannot fire during the drive.
- A job type appears in the pickers only once a job of that name exists or a handler is registered; a job with no handler stays Created forever (it is never claimed).
- The panel renders a desktop grid plus phone cards (hidden, still in the DOM) and the name also labels the parked job's row: identify the panel by its `Edit schedule`/`Cancel schedule` buttons and use `first()` for cron and data text. The buttons show on row hover.
- Toasts stack; wait on the API response or state, not on a toast that may sit under a newer one.
- Detail and list basics, Cancel/Resume, Add Job, single Re-run and Delete are in `jobs.mjs`.
