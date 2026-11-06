---
name: verify-tiny-agents
description: "Launch an isolated tiny-agents web app (own SQLite files, faux model, no network or keys), drive it in Chromium the way a user does, and capture screenshot + ARIA evidence per feature. Use to prove a UI or API change works in the real app, to reproduce a user-facing bug, or when /maintain-verification-skill audits this map."
---

# Verify tiny-agents

tiny-agents is a Node web app (Hono server + React SPA on one port). This skill
starts a **separate, disposable** instance, signs in as the seeded demo user,
drives features through Playwright with stable ARIA handles, and keeps the
proof. It never touches `data/dev.db`, `data/e2e.db` or a dev server you
already have running.

Everything goes through one helper (run from the repo root; it is executable):

```bash
S=.agents/skills/verify-tiny-agents
$S/scripts/ta-verify.mjs up              # fresh instance on :3100, prints READY run=<id>
$S/scripts/ta-verify.mjs doctor          # read-only health check of the current run
$S/scripts/ta-verify.mjs drive $S/journeys/tasks.mjs [more.mjs ...]
$S/scripts/ta-verify.mjs down            # stop it, delete its state, keep evidence
$S/scripts/ta-verify.mjs status          # list runs (* = current)
```

Prerequisite: `pnpm install` has been run (the helper uses `node_modules/.bin/tsx`
and `@playwright/test`).

## Launch

`ta-verify up [--port 3100] [--run <id>] [--sandbox] [--shelley] [--empty]`:

1. Refuses if anything already answers on the port **or port + 1** (the dev server
   puts Vite's HMR socket there). Space concurrent runs 10 apart (3100, 3110, …).
   Never drive an instance you didn't start.
2. Creates `data/verify/<run>/` and seeds `app.db` with `scripts/seed.ts`
   (all Drizzle migrations + `demo@example.com` / `demo@example.com`).
3. Starts `tsx apps/web/src/server/entry.node.ts` **without watch** in its own
   process group with:
   `NODE_ENV=development PORT=<port> DATABASE_URL=file:<run>/app.db AGENT_DB_PATH=<run>/agent.db UPLOADS_DIR=<run>/uploads TINY_AGENTS_FAUX=1 TINY_AGENTS_FAUX_TOKENS_PER_SECOND=6 SANDBOX_HOST= NODE_OPTIONS=--max-old-space-size=1024`.
   The faux model replies `Echo: <your message>` with no network or keys. Every
   run also gets a random `SECRETS_KEY` (vault items, connection secrets) and
   `ADMIN_AUTH_KEY` (journeys read it as `adminKey`, e.g. to create a second user
   through `POST /api/v1/auth/users`).
4. Ready = `/ready` returns `{"ready":true}` (agent runtime started) **and** doctor
   passes (SPA served, demo login works, faux model listed). Boot takes ~10–30 s;
   the helper waits up to 240 s and prints `[ta-verify] READY run=<id> url=…`.

Launch options (journeys that need one declare it, see Drive):

| Option      | Adds                                                                                                                                                                                                                                     | Needs                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `--sandbox` | `SANDBOX_HOST=127.0.0.1` + the local key: Terminal, Computer, Browser and bots' sandbox tools reach the local sandbox container. One `--sandbox` run at a time (the container is shared state).                                          | `pnpm sandbox:up` (Docker; see `docs/guides/local-sandbox.md`)                       |
| `--shelley` | A keyless Shelley (`-predictable-only` model) on port + 1000 with its own DB and `HOME`, and `SHELLEY_URL` pointing at it: `/code` and bots' `code_*` tools. It runs on the **host**: give coding threads a throwaway working directory. | `TA_VERIFY_SHELLEY_BIN`, `shelley` on PATH, or the sandbox container to copy it from |
| `--empty`   | Skips the demo-user seed (migrations still run on boot): first-run `/setup` is reachable. Doctor then checks `GET /api/v1/auth/setup` instead of logging in.                                                                             | —                                                                                    |

Server log: `data/verify/<run>/server.log` (copied into the evidence on `down`).
Because there is no watcher, **relaunch after changing code** (`down`, then `up`);
doctor flags a stale instance.

## Doctor

`ta-verify doctor` (exit 0 = drivable). Checks: our pid alive; the port's
listener belongs to our process group (via `lsof`); `/health` and `/ready` OK;
git HEAD equals the revision at launch; `/login` serves the SPA; demo login
(`POST /api/v1/auth/login`) is 200; `GET /api/v1/models` lists the faux model;
with `--sandbox`, the sandbox SSH port answers; with `--shelley`, Shelley lists its
`predictable` model.
Run it before the first drive and again after any failed drive. If it fails,
`down` and `up` again rather than driving a sick instance.

## Drive

A journey is a Node module under `journeys/` using `scripts/lib.mjs`:

```js
import { journey, expect } from "../scripts/lib.mjs";
await journey("tasks", async ({ page, step, proof, cleanup, api, stamp }) => {
  await step("open Tasks", () => page.goto("/tasks"));
  await proof("tasks-open"); // screenshot + ARIA snapshot
});
```

- `journey(feature, fn, { signIn = true, requires = [] })` launches headless Chromium
  (`TA_VERIFY_HEADED=1` for headed), signs in through the real login form, runs
  `fn`, writes `result.json`, and exits non-zero on any failed step or cleanup.
  `requires: ["sandbox" | "shelley" | "empty"]` names launch options the journey
  needs; run without them it records itself **unreachable** (exit 3) and `drive`
  reports it separately from failures. `caps` and `adminKey` are exported too.
- `step(name, fn)` logs ok/FAIL; a failure captures `failure.png` + `failure.aria.yml`.
- `api.get/post/patch/delete("/tasks")` calls `/api/v1/*` with the page's cookie and
  returns the envelope's `data`: use it for **side-effect checks and setup only**,
  never in place of the user path being proved.
- `cleanup(fn)`: register right after creating a row; cleanups run even when a step
  fails, so failed drives don't leave residue for the next one.
- `stamp`: unique per drive; put it in every name you create.
- Selectors: ARIA roles + accessible names (`getByRole`, `getByLabel`,
  `getByPlaceholder`), `data-testid` where the app ships one. No CSS classes or coordinates.
- Browser: Playwright's own Chromium; if it's missing (containers with a
  pre-installed browser) the lib falls back to `/opt/pw-browsers/chromium`, or set
  `TA_VERIFY_CHROMIUM=/path/to/chrome`.

Per-feature recipes live in [`features/`](features/README.md); each names the journey that drives it.

## Evidence

Location: `data/verify-evidence/<run>/<feature>/` (git-ignored, survives `down`):
`<label>.png`, `<label>.aria.yml` (URL on line 1), `result.json` (every step,
timing, errors, page errors), plus `server.log` at the run root after `down`.

Proof standards:

- Drive the real user path (forms, buttons, keyboard), not internal setters or test-only endpoints.
- Capture the action **and** the resulting state (`proof()` after the change, not only at the end).
- Check side effects with a second view: reload the page, or read the row back through `api`.
- The only stand-ins are the faux model (the AI provider boundary), the
  predictable Shelley (`--shelley`) and the local sandbox container in place of
  the sandbox VM (`--sandbox`). Anything that needs a real model, a signed-in
  Claude account or a remote service is out of reach here: report it as
  unreachable with its prerequisite, not as verified.

## Cleanup

`ta-verify down [--run <id>]`: SIGTERM to the run's process groups (server and,
with `--shelley`, Shelley; SIGKILL after 15 s), never kill by process name; copies
`server.log` (and `shelley.log`) into the evidence; deletes
`data/verify/<run>/`; then fails loudly if the evidence directory is empty or gone.
A port still held after `down` is reported, not killed (not provably ours).
Run `down` after every failed iteration too. Evidence directories are never deleted
by the skill; remove old ones under `data/verify-evidence/` by hand.

## Helpers

| File                    | Invocation                                      | Purpose                                                 |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `scripts/ta-verify.mjs` | `ta-verify.mjs up\|doctor\|drive\|down\|status` | lifecycle + journey runner                              |
| `scripts/lib.mjs`       | imported by journeys                            | browser, login, step/proof/cleanup, API helper          |
| `journeys/*.mjs`        | `ta-verify.mjs drive journeys/<f>.mjs`          | one end-to-end recipe per feature                       |
| `scripts/full-pass.sh`  | `full-pass.sh`                                  | every journey on six fresh parallel runs, then teardown |

Full pass: `up --sandbox --shelley` → `doctor` → `drive $S/journeys/*.mjs` → `down`,
then `up --empty` → `drive` the `requires: ["empty"]` journeys → `down`. With
several agents or terminals, always pass `--run <id>`: `current` is whichever run
started last.
Keep this map honest with `/maintain-verification-skill`.
