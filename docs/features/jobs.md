# Background jobs

The `jobs` table is the queue. There is no broker and no adapter: `addJob()`
inserts a row, `runTick()` claims due rows with a single `UPDATE … RETURNING`
and runs them in-process. On Node a poller calls `runTick()` every few seconds;
on Cloudflare Workers a cron trigger calls it once a minute; and `addJob()`
kicks off an inline tick so a job queued from a request runs right after the
response.

Everything lives in `@groot/jobs`: `@groot/jobs/server` (queue, tick, worker,
routes, logger, schema) and `@groot/jobs/client` (the dashboard). Handlers are
app-owned (`apps/web/src/server/api/<feature>/<feature>.jobs.ts`).

## Tables (`packages/jobs/src/server/schema.ts`)

| Table           | Row                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jobs`          | `id` (uuid), `name`, `data` (JSON), `state`, `priority`, `retryLimit`, `retryCount`, `retryDelay` (s), `runAt`, `startedAt`, `completedAt`, `output` (JSON), `error`, `singletonKey` |
| `job_schedules` | one per job name: `cron`, `data`, `timezone`, `lastRunAt`                                                                                                                            |
| `job_logs`      | `jobId`, `level`, `message`, `data`, `timestamp` (info and above)                                                                                                                    |

States: `created` → `active` → `completed` | `failed` | `cancelled`.

## Lifecycle (`@groot/jobs/lifecycle`)

One runtime-neutral module holds the state machine; the queue and the
dashboard both import it, so the buttons a page shows and the requests the
server accepts cannot drift apart.

| Action   | Allowed from          | Does                                   |
| -------- | --------------------- | -------------------------------------- |
| `retry`  | `failed`, `cancelled` | back to `created`, error cleared       |
| `rerun`  | `completed`, `failed` | queue a fresh copy; the original stays |
| `resume` | `cancelled`           | back to `created`                      |
| `cancel` | `created`, `active`   | to `cancelled`                         |
| `delete` | any state             | remove the row                         |

`JOB_STATES`, `isValidJobState`, `isTerminalJobState`, `JOB_ACTIONS`,
`canApplyJobAction(action, state)` and `allowedJobActions(state)` are exported
from `@groot/jobs/lifecycle` (and re-exported by `@groot/jobs/server`).

Each state change is one compare-and-set `UPDATE … WHERE id = ? AND state IN
(<allowed>) RETURNING`. A cancel that arrives after the tick completed the job
changes nothing and answers `400`; an unknown job answers `404`
(`JOB_NOT_FOUND`). The tick guards its own writes the same way (`WHERE state =
'active'`), so a job cancelled mid-run stays cancelled.

## Handlers

```ts
import { registerJobHandler, type JobContext } from "@groot/jobs/server";

export async function sendDigest(job: JobContext<{ userId: number }>) {
  job.logger.info({ userId: job.data.userId, attempt: job.attempt }, "Sending digest");
  // ...
  return { sent: 1 }; // any JSON-serialisable value is stored as job.output
}

export function registerDigestJobs(): void {
  registerJobHandler("send-digest", sendDigest);
}
```

`JobContext<T>` is `{ id, name, data, attempt, logger }` (`attempt` is 1 for the
Register handlers in `startWebApp()`
(`apps/web/src/server/app.ts`), the one boot sequence both entries run.
Any non-empty name works (routes address a job by its id, never its name). A
job whose name has no registered handler is
never claimed and stays `created`.

## Queueing and managing

```ts
import { addJob, scheduleJob } from "@groot/jobs/server";

await addJob("send-digest", { userId: 1 });
await addJob(
  "send-digest",
  { userId: 1 },
  {
    delaySeconds: 60, // or runAt: new Date(...)
    priority: 5, // higher runs first
    retryLimit: 5, // default config.jobs.retryLimit (3)
    retryDelaySeconds: 30, // base delay, doubles per attempt; default 60
    singletonKey: "user:1", // at most one created/active job per name + key; returns the existing id
  },
);
await scheduleJob("todo-cleanup", { daysToKeep: 30 }, "0 3 * * *", { timezone: "Asia/Kolkata" });
```

| Function                                                                                                                 | Does                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `addJob(name, data, options?)` → id                                                                                      | Insert a `created` row; triggers an inline tick when due                                              |
| `scheduleJob(name, data, cron, { timezone? })`                                                                           | Create or replace the one schedule for `name` (cron validated by croner); replacing keeps `lastRunAt` |
| `cancelScheduledJob(name)`                                                                                               | Delete a schedule                                                                                     |
| `retryJob(id)`, `cancelJob(id)`, `resumeJob(id)`, `rerunJob(id)` → new id, `deleteJob(id)`, `rerunJobs(ids)`             | The [lifecycle](#lifecycle-grootjobslifecycle) actions                                                |
| `getJobs`, `getJobById(id)`, `getQueueStats`, `getAvailableQueues`, `getScheduledJobs`, `getJobLogs`, `purgeJobsByState` | Queries (`queries.ts`)                                                                                |

## The tick (`packages/jobs/src/server/tick.ts`)

One `runTick()` pass:

1. **Schedules** — for each row in `job_schedules`, compute the next fire after
   `lastRunAt ?? createdAt`; if it is due, compare-and-set `lastRunAt` and
   insert a job. Two concurrent ticks can never enqueue the same fire.
2. **Recover** — `active` jobs whose `startedAt` is older than
   `config.jobs.activeTimeoutSeconds` (300) are put back to `created` with
   `retryCount + 1`, or `failed` when retries are exhausted.
3. **Claim** — up to `config.jobs.batchSize` (10) `created` jobs with
   `runAt ≤ now` and a registered handler, ordered by priority desc, `runAt`,
   `createdAt`, moved to `active` in one `UPDATE … WHERE id IN (subquery) RETURNING`.
4. **Run** each claimed job sequentially. Success → `completed` with `output`.
   A throw → `created` again with `runAt = now + retryDelay × 2^retryCount`
   seconds (capped at 24 h) while `retryCount < retryLimit`, otherwise `failed`
   with the error message. Failures go to `reportError()`.
5. **Housekeeping** every 10 minutes: delete `completed`/`cancelled` jobs older
   than `config.jobs.keepCompletedDays` (7) and their logs, and purge expired
   kv entries.

Only one tick runs at a time per process; a `runTick()` call during a tick
schedules one more pass after it.

## Who calls the tick

| Runtime | Driver                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node    | `startWorkers()` in `entry.node.ts`: one tick immediately, then every `config.jobs.pollIntervalSeconds` (5); `stopWorkers()` on shutdown waits for the in-flight tick                     |
| Workers | the `scheduled` handler (cron `* * * * *` in `wrangler.jsonc`) → `ctx.waitUntil(runTick())`                                                                                               |
| Both    | `addJob()` and `retryJob()` run an inline tick (schedules and housekeeping skipped) when `config.jobs.runInline` is true and the job is due; on Workers through the request's `waitUntil` |
| Tests   | jobs are disabled; call `await runTick()` yourself                                                                                                                                        |

## Configuration (`config.jobs`)

| Key                    | Default                   |
| ---------------------- | ------------------------- |
| `enabled`              | `true` (`false` in tests) |
| `pollIntervalSeconds`  | `5` (Node poller)         |
| `batchSize`            | `10`                      |
| `retryLimit`           | `3`                       |
| `retryDelaySeconds`    | `60`                      |
| `activeTimeoutSeconds` | `300`                     |
| `keepCompletedDays`    | `7`                       |
| `runInline`            | `true`                    |

Override in `apps/web/src/server/config.ts`; see [Config](../config.md).

## Logs

`job.logger` writes to the normal log stream and persists `info` and above to
`job_logs`, which the dashboard shows per job. `createJobLogger({ jobId, jobName })`
builds one outside a handler; `flushJobLogs()` waits for pending writes (the
tick does this before marking a job done).

## HTTP API (`/api/v1/jobs`, JWT)

| Method | Path                                    | Body / query                                       | Returns                                        |
| ------ | --------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| POST   | `/`                                     | `{ jobName, data?, options? }`                     | `201` `{ jobId, jobName, data }`               |
| POST   | `/schedule`                             | `{ jobName, cron, data?, options?: { timezone } }` | `201` the schedule (creates or replaces)       |
| GET    | `/schedule`                             |                                                    | schedules                                      |
| DELETE | `/schedule/:jobName`                    |                                                    | `200` `{ success: true }`                      |
| GET    | `/stats`                                |                                                    | counts per state                               |
| GET    | `/available`                            |                                                    | `{ jobs: string[] }` (names seen + registered) |
| DELETE | `/state/:state`                         |                                                    | `{ count }` purged                             |
| GET    | `/`                                     | `?state&name&startDate&endDate&limit&offset`       | `{ jobs, total }`                              |
| GET    | `/:jobId`                               |                                                    | the job                                        |
| GET    | `/:jobId/logs`                          | `?afterId`                                         | log rows                                       |
| DELETE | `/:jobId`                               |                                                    | `200` `{ success: true }`                      |
| POST   | `/:jobId/retry` · `/cancel` · `/resume` |                                                    | `200` `{ success: true }`                      |
| POST   | `/:jobId/rerun`                         |                                                    | `{ newJobId }`                                 |
| POST   | `/bulk-rerun`                           | `{ jobIds: string[] }`                             | `[{ jobId, success, newJobId?, error? }]`      |

`:jobId` is the job's uuid. curl examples in [API requests](../examples/api-requests.md#jobs-jwt).

## Dashboard

The `/jobs` page comes from `@groot/jobs/client`: `Jobs` and `JobDetail` pages,
`useJobs` / `useJobDetail` / `useJobActions` hooks, `jobsApi`, and the table,
stats, filter, log and dialog components. It talks to the API above through
`apiClient`.

- The table's row menu and the detail page's buttons both render
  `allowedJobActions(job.state)` and run them through `useJobActions()`, which
  owns the toasts, the delete confirmation and the query invalidation.
- `useJobs()` holds only the list: the URL filters and the page of jobs.
  `JobsTable` owns the row selection (a `Set` of job ids, cleared when the
  filters change) and renders one accessible table: each row is a `row` named
  `Job <name> (<short id>)` with a "Select job …" checkbox, an "Actions for
  job …" menu and a "View details for job …" link to `/jobs/:jobId`. `JobsStats`, `ScheduledJobsPanel` and the job-type pickers load
  their own data through the hooks in `@groot/jobs/client/queries`.
- `AddJobDialog` and `ScheduleJobDialog` own their drafts, submit, toast and
  refresh the queries they affect. Both edit the payload in `JobDataEditor`
  (CodeMirror). `ScheduleJobDialog` creates a schedule, or edits one when
  given `schedule` (the name is fixed, the timezone is kept, and it saves
  through `POST /schedule`).
- The detail page fetches the job and its logs on load and polls both every
  2 s while the job is `created` or `active`; polling stops once it finishes.

## Reference jobs

| Job            | Handler                                     | Does                                                         |
| -------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `todo-cleanup` | `apps/web/src/server/api/todo/todo.jobs.ts` | Deletes completed todos older than `daysToKeep` (default 30) |
| `todo-summary` | same file                                   | Counts todos; the summary is the job output                  |

## Good practice

- Keep handlers idempotent: a crashed process re-runs them after the active timeout.
- Keep them short. On the Workers free plan a cron run and a request each get
  about 10 ms of CPU (waiting on D1 or `fetch` is free, computing is not).
- Use `singletonKey` to collapse duplicate work while a job is pending.
- Return small outputs; put large results somewhere else and return a reference.
- Cron expressions are UTC unless a `timezone` is given.
