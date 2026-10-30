# Docs Changelog

## 2026-10-27

- `guides/deploy.md` and `features/storage.md`: mount the Node deploy's persistent volume at `/data`, instead of `/app/data`, so it doesn't depend on the build's working directory or hide the repo's `data/` folder. Production keeps the database at `/data/prod.db` and uploads at `/data/uploads` by default, so `DATABASE_URL` and `UPLOADS_DIR` are optional

## 2026-10-25

- Rewrote the documentation for the Hono + Drizzle + SQLite stack that runs on Node and Cloudflare Workers ([ADR 0004](./adr/0004-hono-drizzle-sqlite-workers.md)):
  - `README.md`, `AGENTS.md`, `docs/README.md`, quick start and setup guide: zero-config development (`pnpm install && pnpm dev`, demo user), the new tech stack, `.env.example` + `packages/core/src/env.ts` instead of a schema file
  - Guides: architecture (`createApp()`, `bootstrap()`, the two entries), development (Hono routers + Drizzle services end to end), database migrations (drizzle-kit, SQLite only), testing (`app.request()` helpers on in-memory SQLite), deploy on Node (`pnpm start` migrates on boot) and the new `guides/deploy-cloudflare.md` (D1, R2, cron trigger, free-plan limits, first user via the admin API)
  - `config.md` documents `config.ts` / `defineConfig()`; `kv.md` documents the `kv` table store
  - Features: jobs (table-backed queue, `runTick()`, HTTP API with status codes), todos, storage (`StorageAdapter` contract with local/R2/memory adapters), passkeys (challenges in kv, relying party from env), client
  - `examples/api-requests.md` with expected status codes; `sentry-source-maps.md` with the new map paths (`dist/server/*.map`, `dist/client/assets/*.map`)
  - Removed `database-engines.md` (one engine now; the story lives in `guides/database-migrations.md`); updated the groot-sync skill tables and the node skill's environment rule

## 2026-07-17

- Documented dual-database-engine support (SQLite default, PostgreSQL opt-in via `DATABASE_ENGINE`):
  - New `database-engines.md` guide (removed 2026-10-25) covering engine selection, the `Json` parity strategy, two schema files, and the job-queue adapter pattern (pg-boss on Postgres, honker on SQLite)
  - Updated setup, quick-start, architecture, jobs, KV, testing, and migration guides to reflect both engines
  - Added `test:sqlite` / `test:postgres` / `test:all` scripts and documented the dual-engine CI matrix workflow
- Updated `README.md`, `AGENTS.md`, and `docs/README.md` tech-stack tables to list SQLite/PostgreSQL and pg-boss/honker

## 2026-04-07

- Updated all documentation to reflect new domain-driven architecture:
  - Replaced references to old folder structure (`controllers/`, `services/`, `models/`, `routes/`, `validations/`)
  - Documented new `app/` and `shared/` feature module organization
  - Updated patterns to use `createRouter()` utility and functional controllers
  - Changed auth references from `basicAuthMiddleware` to `jwtAuthMiddleware`
  - Updated error handling to use `Boom` factory methods
- Updated `CLAUDE.md`:
  - New directory structure with `app/` and `shared/` feature modules
  - Route registration via `routes.ts`
  - Controller pattern (simple functions returning values)
  - Dynamic job registration pattern
- Updated `docs/guides/architecture.md`:
  - Feature module structure and organization
  - Request flow with `createRouter` and `handle` middleware
  - Core module overview (ai, errors, job, kv, logger, storage)
- Updated `docs/guides/development.md`:
  - New feature creation workflow
  - Modern code patterns
- Updated `docs/guides/testing.md`:
  - Updated test structure and patterns
  - Modern mocking examples
- Updated `docs/README.md`:
  - New architecture overview
  - Updated tech stack and module list
- Updated `docs/quick-start.md`:
  - New API endpoint patterns
  - Updated examples
- Updated `docs/features/todos.md`:
  - Feature module structure
  - Modern controller/service patterns
- Updated `docs/features/storage.md`:
  - Module organization
  - Updated auth patterns
- Updated `docs/features/jobs.md`:
  - Modularized job system
  - Dynamic handler registration
- Updated `docs/boilerplate-enhancements.md`:
  - Complete rewrite reflecting current architecture
  - Domain-driven structure
  - Core infrastructure modules

## 2026-03-14

- Migrated to Vite+ unified toolchain:
  - Replaced Biome with Vite+ (Oxlint + Oxfmt) for linting and formatting
  - Updated all `vite` imports to `vite-plus`
  - Updated all `vitest` imports to `vite-plus/test`
  - Consolidated config into `vite.config.ts` with `lint`, `fmt`, `staged` blocks
  - Created `vitest.config.server.ts` for server tests with proper alias resolution
  - Fixed `manualChunks` to use function format (Vite 8/Rolldown requirement)
  - Updated `server/src/index.ts` dynamic import from `vite` to `vite-plus`
- Migrated pre-commit hooks to Vite+:
  - Removed `.pre-commit-config.yaml` (no longer need pre-commit CLI)
  - Updated `.vite-hooks/pre-commit` to run Gitleaks + `vp staged`
  - Updated `docs/precommit-hooks.md` documentation
- Cleaned up duplicate test files in `client/src/` and `server/src/`
- Updated `baseline-browser-mapping` to latest version
- Updated `CLAUDE.md` with new tooling documentation

## 2025-11-15

- Seeded documentation hub mirroring Nesin's Finance API style:
  - Added setup guide, architecture overview, development workflow, and testing guide
  - Documented todos API, background jobs, and client patterns
  - Published API request examples and changelog for future updates
