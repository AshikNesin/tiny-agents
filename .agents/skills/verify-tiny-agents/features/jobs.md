# Background jobs

The owner watches the background queue on `/jobs`: per-state counts that filter the list, a table of jobs with a row menu, a detail page per job with its overview, payload, output, error and logs, and the lifecycle buttons the job's state allows (Cancel, Resume, Retry, Re-run, Delete). Saving an enabled routine is the everyday action that queues a real `routine-fire` job.

## Sub-features

- `jobs-list` lists jobs as rows named `Job <name> (<first 6 of id>)` with a status badge.
- `jobs-filter` filters by state from the stat tiles (`Created`, `Failed`, …) or the state tabs; the URL carries `?state=`; a filtered view offers `Purge <State>`.
- `jobs-row-link` opens a job's detail from its row (currently broken, see Gotchas).
- `jobs-detail` shows title, state badge, id, Overview (Priority, Retries, Run At, Started, Completed, Duration), Data, Output, Error and Logs (`No logs available` when empty).
- `jobs-cancel-resume` cancels a queued job and resumes it (it then runs at once and the page polls it to Completed).
- `jobs-add` queues a job from `Add Job` (type picker + JSON payload) with a `View job (<id>)` toast link.
- `jobs-failed` shows a failed job's Error card with Retry and Re-run; Re-run queues a copy and keeps the original.
- `jobs-delete` deletes from the row menu or the detail page after confirming.
- `jobs-not-found` shows `Job Not Found` with `Back to Jobs` for an unknown id.

## How to get to it (user POV)

- Only by URL: `/jobs` is not in the sidebar, the account menu or the ⌘K palette.
- Detail: `/jobs/<queueName>/<jobId>` (the route the app mounts, e.g. `/jobs/routine-fire/<uuid>`).
- A real job: create an enabled routine (Routines → New routine → Save, or `POST /api/v1/routines` with `enabled: true`); it queues one `routine-fire` job for its next occurrence.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK (which includes `push notifications off`), signed in. The journey also refuses to run unless `GET /api/v1/notifications/status` is `not_configured`, because resuming a routine-fire job runs a real routine occurrence.

- **Armed job.** Setup (API): a faux bot and an enabled 15-minute routine; its `routine-fire` job is `created`.
- **List and filter.** `/jobs`: heading `Jobs`, row `Job routine-fire (<short>)` with status `Created`. Stat tile button `Created …` → URL `state=created`, heading `Created jobs`, button `Purge Created`.
- **Row link.** Link `View details for job routine-fire (<short>)` should open the detail page.
- **Detail.** `/jobs/routine-fire/<id>`: heading `routine-fire`, the id, `Created`, `Overview`, `Retries`, the routine id in Data, `No logs available`; buttons `Cancel` and `Delete`, no `Retry`.
- **Cancel / Resume.** `Cancel` → toast `Job has been cancelled`, buttons `Resume` + `Retry`, API state `cancelled`. `Resume` → toast `Job has been resumed`; the page polls to `Completed` with `Re-run`; API state `completed`.
- **Add Job.** `Add Job` → dialog `Add New Job`: payload editor (CodeMirror) `{"routineId": "verify-missing-<stamp>", "scheduledFor": "2026-01-01T00:00:00.000Z"}`, button `Job type` → menuitem `routine-fire`, `Add Job`. Toast `Job has been added to the queue.`; the job reaches `completed` (an orphan fire is acknowledged). Its detail shows `Completed`, the payload, `Re-run`, no `Cancel`.
- **Failed.** Setup (API): `POST /api/v1/jobs` `{ jobName: "routine-fire", data: { verify: <stamp> }, options: { retryLimit: 0 } }` fails at once. Detail: `Failed`, `Error` card (the payload validation error), `Retry`, `Re-run`. `Re-run` → toast `Job re-run created.`; a new job with the same data exists and the original stays `failed`.
- **Delete.** `/jobs?state=failed`: heading `Failed jobs`, row menu `Actions for job routine-fire (<short>)` → `Delete` → alertdialog `Delete job routine-fire (<short>)?` → `Delete`; toast `Job has been deleted`; API 404. Detail `Delete` → confirm → back on `/jobs`; API 404.
- **Not found.** `/jobs/routine-fire/00000000-0000-4000-8000-000000000000` → `Job Not Found`, `Back to Jobs`.
- **Proof.** `ta-verify drive $S/journeys/jobs.mjs` → `jobs/list`, `jobs/filtered-created`, `jobs/detail-created`, `jobs/detail-cancelled`, `jobs/detail-resumed-completed`, `jobs/detail-completed`, `jobs/detail-failed`, `jobs/not-found`, plus `jobs/bug-N` for each known bug.

## Gotchas

- KNOWN PRODUCT BUG: every in-app link to a job points at `/jobs/<id>` (row link, `View job` toast after Add Job, `View new job` after Re-run), but the app mounts `/jobs/:queueName/:jobId`, so `/jobs/<id>` falls through to `*` → `/` → `/chats/<last bot>`. The journey asserts the correct behaviour in two steps and fails at the end; it reaches details by the mounted URL meanwhile.
- `Resume` and `Retry` set the run time to now: resuming an armed routine's job fires that routine's occurrence early (a real routine run on the faux model) and queues the next one.
- Deleting a routine only cancels its pending job; cancelled and completed jobs stay listed. The journey's last cleanup deletes every job carrying its routine id or stamp.
- Type the payload with `keyboard.insertText` (CodeMirror auto-closes quotes on `type()`), and edit the payload before opening the `Job type` menu: the menu's focus return can swallow the editor click.
- Jobs are global to the instance; filter by your own ids, not by counts.
