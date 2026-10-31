---
"groot": patch
---

Sync with groot @ a4b4a76 (no release: upstream changes arrive through the
boilerplate, and each upstream change ships with its own changeset there).

Upstream commits since 82e7def:

- `84750cd` Docs cleanup — docs reorganized into `guides/`, `features/` and
  the new `reference/` section (`config.md` → `reference/config.md`,
  `examples/api-requests.md` → `reference/api-requests.md`,
  `sentry-source-maps.md`/`sync-guide.md`/`precommit-hooks.md` →
  `guides/…`, `kv.md` → `features/kv.md`, `CHANGELOG.md` dropped).
- `6861735` chore: ignore everything inside `data/` — `.gitignore` now uses
  `/data/*` + `!data/.gitkeep` (covers the agent store's `.lock` sidecars and
  browser profiles too).
- `1f33ccc` refactor jobs cleaning — `kv_expires_at_idx` and
  `jobs_state_completed_at_idx` indexes (migration `0001_even_power_man.sql`
  generated here), housekeeping queries follow deletes, housekeeping test
  updated.
- `a4b4a76` perf: sentry loading — `@sentry/node` is imported dynamically
  only when `config.sentry.dsn` is set; ported to
  `apps/web/src/server/entry.node.ts` (app code, outside the sync patterns).
- `a7a0f17` feat(ui): dialogs dismiss on outside click + Dialog test.

Conflicts resolved keeping tiny-agents specifics: docs index keeps the
tiny-agents feature rows and Node-only notes, deploy.md keeps the two-SQLite
volume layout (`/data/app.db`, `/data/agent.db`) and the chromium/ssh2 native
module facts, `scripts/db-migrate.ts` keeps the bootstrap + legacy-copy path
and adopts `.env` loading.
