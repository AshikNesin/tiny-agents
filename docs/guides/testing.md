# Testing

Vitest (through Vite+) for server and client tests, Playwright for end to end.
Server tests never start an HTTP server: the Hono app is called in-process with
`app.request()` against an in-memory SQLite database.

## What a test proves

The rules for agents are in [AGENTS.md](../../AGENTS.md#testing). A test calls
the real code and asserts a result a caller can see: a return value, a saved
row, an HTTP response, or text on the screen. It fails on the code before the
change. Mock the network, the clock, or a third-party SDK. Do not mock the
function the test covers and then assert that the mock ran.

## Commands

```bash
pnpm test           # server tests, single run
pnpm test:watch     # server tests, watch mode
pnpm test:client    # client tests (jsdom)
pnpm test:all       # both
pnpm test:e2e       # Playwright (starts the dev server itself)
```

## Server test setup

`tests/server/setup.ts` runs before every test file and calls the same
`bootstrap()` as the entry, with:

- `NODE_ENV=test`, `DATABASE_URL=":memory:"`, `LOG_LEVEL=silent`
- a fresh in-memory database per file, copied from a template that every
  migration and the faux model rows went into once per module load
  (`tests/server/fixtures/test-db.ts`): once per worker in the `server`
  project, once per file in `server:isolated`
- `memoryStorage()` for uploads
- `jobs.enabled = false` (a `NODE_ENV=test` default), so nothing runs in the
  background; tests call `runTick()` when they want jobs processed

Within a file, clear what you need in `beforeEach` (e.g.
`await db.delete(tasks)`, `jobRunner.reset()`). A test that records ids or
reads whole tables calls `await useFreshTestDatabase()` (from
`tests/server/fixtures/test-db.ts`) first in `beforeEach`. It gets a new copy
of the seeded database and an empty App root, the way a new file starts, so
the ids it sees do not depend on the tests before it. The golden flows do
this.

## Random order

Both suites run with `sequence.shuffle`: files, and the tests in each file,
run in a new random order every run. A test that passes only after (or
before) another one fails sooner or later. The seed is printed at the top of
the run (`Running tests with seed "1234"`). Rerun that order with
`pnpm test --sequence.seed=1234` (or `pnpm test:client --sequence.seed=1234`)
and fix the dependency; never pin a seed. Mock call history is cleared before
every test (Vitest's default `clearMocks`), so a test never sees calls an
earlier one made.

The client setup (`tests/client/setup.ts`) undoes what a test leaves in the
document after each test: it unmounts with `cleanup()`, dismisses Sonner's
toasts (Sonner replays the active ones to the next `Toaster`), and puts the
`<html>` and `<body>` attributes back.

## Isolation between files

The `server` project runs with `isolate: false`: each worker loads the app's
modules once and runs file after file in them, instead of loading them again
for every file. That cut the suite from about 190 s to 45 s. What one file
leaves in a module is there for the next file in its worker, so after every
file `tests/server/fixtures/file-isolation.ts` stops and resets what the App
root holds, closes the file's database, and fails the file if it left anything
that reset cannot undo: env or globals set without `vi.stubEnv` or
`vi.stubGlobal`, or a server, socket, child, watcher or due timer still open.

The rules that follow:

- Set env vars with `vi.stubEnv` and globals with `vi.stubGlobal`, never by
  assignment.
- Close every server, socket and child process the file opens, in the test or
  in `afterAll`, and await the close.
- Clear a timer you race against (`Promise.race([work, timeout])`): put the
  `clearTimeout` in a `finally`. An unref'd timer does not count, so
  `AbortSignal.timeout()` after a finished fetch is fine. A loop that must
  stop belongs in a service the reset stops.
- Keep fixture caches per database, not per process
  (`tests/server/fixtures/auth.ts` keys its tokens by the database).
- A file that calls `vi.mock` or `vi.doMock` runs in the `server:isolated`
  project, which loads modules per file. `vitest.config.server.ts` finds those
  files by reading them, so there is no list to keep. A mock cannot replace a
  module an earlier file in a shared worker already loaded.

`tests/server/checks/file-isolation.test.ts` runs a probe file for each kind
of leak through the real setup and checks that each one fails.

## Helpers (`tests/server/helpers.ts`)

| Helper                                             | Does                                                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTestApp(options?)`                          | `createWebApp()` — the real app with every router and rate-limit counters of its own. Pass `clientAddress` (a resolver such as `(c) => c.req.header("x-test-peer")`) to say who each request is from instead of faking a socket |
| `setAppConfig(overrides?)`                         | The app's config with `overrides` on top; call it bare to restore. A bare `setConfig()` would drop the app's own overrides                                                                                                      |
| `api(app, path, { method, json, token, headers })` | Sends the request, returns `{ status, headers, body }`; `body` is the envelope, a 204 yields `{ success: true }`                                                                                                                |
| `signIn(app)`                                      | Creates a unique user and logs in; returns `{ token, user, email, password, cookie }`                                                                                                                                           |
| `adminHeaders()`                                   | `{ "x-admin-auth-key": env.ADMIN_AUTH_KEY }`                                                                                                                                                                                    |

## Layout

```
tests/
├── server/
│   ├── setup.ts · helpers.ts
│   ├── core/      # @groot/core units: env, config, logger, kv, storage adapters, …
│   ├── jobs/      # @groot/jobs/server: queue + tick, schedules, housekeeping, routes, job logger
│   ├── api/       # HTTP tests through the routers (auth, passkey, settings, storage) and app services
│   ├── app/       # app-owned: bot messaging, durability, the agent toolkits
│   ├── routes/    # app-owned HTTP tests: bots, routines, vault, browser, terminal, …
│   ├── checks/    # repo guards: the gates, hooks and CI scripts
│   ├── groot/     # sync tooling
│   └── scripts/   # build scripts (runtime closure)
├── client/        # jsdom + testing-library (configured in vite.config.ts)
├── e2e/           # Playwright specs + global-setup.ts
└── kit-consumers/ # compiled fixture for pnpm typecheck:kit (never executed)
```

`tests/server/setup.ts`, `tests/server/{core,jobs,api,groot}` and `tests/client`
sync with the source they exercise (`TEST_AREA_OWNERSHIP` in
`.groot/lib/patterns.ts`); `tests/server/app` and `tests/e2e` stay project-local.

`pnpm typecheck` compiles every test with the code it tests: `tsconfig.json`
includes `tests/server`, `apps/web/tsconfig.json` includes `tests/client`, and
`tests/e2e/tsconfig.json` covers the Playwright specs. A wrong import or a
missing argument in a test fails there, before the suite runs.

## Patterns

### An API test

```ts
import { describe, expect, it } from "vite-plus/test";
import { api, createTestApp, signIn } from "../helpers";

const app = createTestApp();

describe("tasks API", () => {
  it("creates, lists and deletes", async () => {
    const { token } = await signIn(app);
    const created = await api<{ id: string }>(app, "/api/v1/tasks", {
      method: "POST",
      json: { title: "Write tests" },
      token,
    });
    expect(created.status).toBe(200);
    const id = created.body.data!.id;
    expect((await api(app, `/api/v1/tasks/${id}`, { method: "DELETE", token })).status).toBe(200);
    const list = await api<{ id: string }[]>(app, "/api/v1/tasks", { token });
    expect(list.body.data!.some((task) => task.id === id)).toBe(false);
  });

  it("rejects an invalid payload", async () => {
    const { token } = await signIn(app);
    const res = await api(app, "/api/v1/tasks", { method: "POST", json: { title: "" }, token });
    expect(res.status).toBe(400);
    expect(res.body.error?.details).toMatchObject({ title: [expect.any(String)] });
  });
});
```

### A job test

```ts
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { db } from "@groot/core/database";
import { addJob, jobRunner, jobs, registerJobHandler, runTick } from "@groot/jobs/server";

beforeEach(() => jobRunner.reset());

it("runs a job and stores its output", async () => {
  registerJobHandler<{ n: number }>("double", (job) => ({ doubled: job.data.n * 2 }));
  const id = await addJob("double", { n: 21 });
  expect(await runTick()).toMatchObject({ claimed: 1, completed: 1 });
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  expect(row).toMatchObject({ state: "completed", output: { doubled: 42 } });
});
```

### An admin route

```ts
const res = await api(app, "/api/v1/auth/users", {
  method: "POST",
  headers: adminHeaders(),
  json: { email: "new@example.com", password: "a-long-password" },
});
expect(res.status).toBe(201);
```

### Services and units

Call them directly; the database is real, so there is nothing to mock
(`tests/server/core/kv.test.ts`, `tests/server/jobs/queue.test.ts`). Reach for
`vi.mock` only for external services.

### A client component

Render it the way `main.tsx` mounts the app: a client from
`createShellQueryClient({ queries: { retry: false } })` in a
`ShellQueryProvider`, and `GrootUIProvider` for confirmations and toasts. Stub
`fetch` with `vi.stubGlobal` rather than mocking `apiClient`, so the envelope,
`ApiError` and the error wording are the real ones, and assert on the toast
text a person reads (`tests/client/components/shell/AppSettings.test.tsx`,
`tests/client/lib/query-client.test.tsx`).

### Dates and time

Both setup files call `pinClockWhileLoadingAndBeforeEachTest()` from
`tests/test-clock.ts`. It runs `vi.setSystemTime(FIXED_NOW)` when the setup
loads and again before every test, so `Date` reports `FIXED_NOW` on any real
day and does not tick. That covers a test file's module scope too,
such as a token minted at the top of the file. Only `Date` is faked:
`setTimeout`, `setInterval` and `performance.now()` stay real.

- A fixture that must lie in the future uses `futureIso(days)`, never a date
  literal. A literal passes on the day it is written and fails once the real
  clock passes it. Against the frozen clock it gives the same result on any
  day.
- A test that needs another instant calls `vi.setSystemTime(...)` in its body.
  The next test starts at `FIXED_NOW` again.
- A test that needs time to pass (a TTL that lapses, a measured wait, two calls
  that need distinct milliseconds) moves the frozen clock forward with
  `vi.setSystemTime(Date.now() + ms)` instead of sleeping, as in
  `tests/server/core/kv.test.ts`.
- Code that reads `Date.now()` between timers, such as a deadline loop, runs
  under `vi.useFakeTimers()` with `await vi.advanceTimersByTimeAsync(ms)`. The
  default fakes `Date` too, starting at `FIXED_NOW`, so both move together
  (`tests/server/app/agent/computer-toolkit.test.ts`). Reset with
  `vi.useRealTimers()` in `afterEach`.
- `vi.useFakeTimers({ toFake: [...] })` without `"Date"` in the list puts the
  real `Date` back until `vi.useRealTimers()`, and `vi.setSystemTime(...)`
  then moves only the fake timers' clock, not `Date`
  (`tests/server/api/notifications/notifications.wiring.test.ts`). List
  `"Date"` when the test writes or compares dates. The setup's `beforeEach`
  calls `vi.useRealTimers()` before it pins `FIXED_NOW`, so the next test
  starts frozen even if this one never restored its timers.
- Wait for asynchronous work with `until(check, what, ms)` or
  `eventually(check, ms)` from `tests/server/fixtures/until.ts`, never a
  `Date.now()` deadline loop, which never ends on the frozen clock. Their
  deadlines read real time and stop just before the test's own timeout, so a
  stuck wait fails with `Timed out waiting for <what>` rather than vitest's
  generic timeout.
- Do not call `vi.useRealTimers()` to opt a test out of the frozen clock. A row
  written at the real time is later read against `FIXED_NOW`, and the result
  depends on the day the suite runs. Call it only to undo `vi.useFakeTimers()`.

## Coverage checklist per route

1. Success path with the right status (`200`, `201`, `204`) and body shape
2. Validation errors (`400` with `error.details`)
3. Auth guard (`401` without a token; `401`/`403` on admin routes)
4. Edge cases: missing resources (`404`), bad ids, pagination limits

## Client tests

Vitest + `@testing-library/react` in jsdom, aliases shared with the build:

```tsx
import { describe, expect, it } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { Button } from "@groot/ui/button";

it("renders", () => {
  render(<Button>Click me</Button>);
  expect(screen.getByText("Click me")).toBeInTheDocument();
});
```

## End to end

`pnpm test:e2e` runs `tests/e2e/*.spec.ts` in Chromium, headed locally and
headless when `CI` is set (`playwright test -c playwright.headless.config.ts`
forces headless with a list reporter). It launches Playwright's own Chromium,
or `PLAYWRIGHT_CHROMIUM_PATH` when set; a container that pre-installs Chromium
for another Playwright version at `/opt/pw-browsers/chromium` gets that one
without `playwright install`. Playwright starts the server itself on
`http://localhost:3000` against a throwaway database: it deletes
`data/e2e.db*`, seeds it with `scripts/seed.ts` and runs
`tsx watch apps/web/src/server/entry.node.ts` with
`DATABASE_URL=file:./data/e2e.db` and `AUTH_RATE_LIMIT_MAX=1000` (every spec
signs in from 127.0.0.1, past the default 20 logins per 15 minutes);
`tests/e2e/global-setup.ts` runs the same `seed()`, so the demo user exists.
Your `data/dev.db` is never touched.

Outside CI an already running server on port 3000 is reused (for example
`PORTLESS=0 pnpm dev`); the specs then run against that server's database and
its rate limit, so start it with `AUTH_RATE_LIMIT_MAX=1000` too.
CI does not run Playwright.

## Continuous integration

`.github/workflows/test.yml` is two jobs, `CI (1/2)` and `CI (2/2)`, both
required checks, on a fresh VM each; its steps say which phases each part
runs. The gates come from `scripts/gates.mjs`, each part runs shard `i/2` of
every suite, and `.github/actions/setup` restores what a job reuses from the
Actions cache. `pnpm check:coverage` (`scripts/lib/workflow-coverage.ts`)
fails when the workflow drifts from the gates, budgets or shard matrix.

### Selection and the merge queue

On a pull request `scripts/test-selection.mjs` runs only the test files the
diff can reach (`--changed=<merge base>`), unless a changed file matches its
`RUN_EVERYTHING`: something the import graph cannot see, which runs
everything. The run's log and step summary name the file that triggered it.
Every other event, the merge queue included, runs every test, so the full suite
runs on the exact commit a branch lands as. What selection cannot see, the
queue catches: a script a test runs as a subprocess, a worker entry started
from a string, a file read at runtime.

`tests/sequencer.ts` splits each suite across shards by the times in
`tests/durations.json`, so the shards finish together. Run
`pnpm test:durations` after adding or removing test files; a file it has not
recorded counts as the median.

Each phase is timed against its budget in `scripts/ci-budget.mjs`, and a phase
past its budget fails the part even when its checks passed. Make the phase
faster, or raise its budget there with the reason in the PR; never with a
`timeout-minutes`.
