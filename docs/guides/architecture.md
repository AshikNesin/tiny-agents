# Architecture

How the server is put together and the conventions every feature module
follows. The same Hono app runs on Node and on Cloudflare Workers; only the
entry file differs.

## Layout

```
packages/core/src/                 # Boilerplate (synced)
├── app.ts                         # createApp(): middleware, /health, /ready, error envelope
├── bootstrap.ts                   # env → config → logger → db → storage → error reporter
├── env.ts · config.ts             # Zod env schema · typed AppConfig + defineConfig()
├── context.ts                     # AsyncLocalStorage request context, waitUntil()
├── types.ts                       # AppEnv (Hono generics), AuthUser
├── database/                      # db handle (index.ts), core tables (schema.ts), Node driver (node.ts)
├── auth/ passkey/ settings/       # Reusable feature modules (routes + service + schema)
├── storage/                       # StorageAdapter contract, local/R2/memory adapters, routes
├── kv/ logger/ errors/            # kv table store · JSON logger + breadcrumbs · Boom + reporting seam
├── middlewares/                   # request logger, JWT, admin key, rate limit, error handler
└── utils/                         # ok()/noContent(), parseBody()/parseQuery()/parseId(), jwt, password

packages/jobs/src/server/          # queue, tick, worker, dashboard API — see features/jobs.md

apps/web/src/server/               # App-owned (not synced)
├── app.ts                         # createWebApp(): mounts every router; registerJobHandlers()
├── config.ts                      # defineConfig() overrides
├── entry.node.ts · entry.worker.ts
├── db/schema.ts                   # app tables; drizzle-kit entry (re-exports core + jobs tables)
└── api/<feature>/                 # feature.routes.ts, .service.ts, .schema.ts, .jobs.ts
```

## Request flow

```
HTTP request
  → requestLoggerMiddleware   request id (x-request-id), child logger, AsyncLocalStorage context, one log line
  → cors                      config.cors.origins (empty = reflect the requesting origin)
  → bodyLimit                 1 MB JSON on /api/* (storage sets its own 100 MB limit)
  → router                    new Hono<AppEnv>() mounted in apps/web/src/server/app.ts
  → handler                   await parseBody(c, schema) → service → ok(c, data, status?)
  → service                   Drizzle query builder → SQLite
  → errorHandler              anything thrown → { success: false, error: { code, message, details } }
```

`/api/v1/auth` and `/api/v1/passkey` are mounted directly (their login routes
are public and rate-limited); every other router is mounted on a sub-app that
runs `jwtAuthMiddleware` first.

## Writing a feature module

Routes are plain Hono routers; handlers parse, call a service, and return the
envelope:

```ts
import { Hono } from "hono";
import type { AppEnv } from "@groot/core/types";
import { ok, noContent } from "@groot/core/utils/api-response.utils";
import { parseBody, parseId } from "@groot/core/utils/controller.utils";
import * as service from "./post.service";
import { createPostSchema } from "./post.schema";

const router = new Hono<AppEnv>();

router.get("/", async (c) => ok(c, await service.findAll()));
router.post("/", async (c) =>
  ok(c, await service.create(await parseBody(c, createPostSchema)), 201),
);
router.get("/:id", async (c) => ok(c, await service.findById(parseId(c.req.param("id")))));
router.delete("/:id", async (c) => {
  await service.remove(parseId(c.req.param("id")));
  return noContent(c);
});

export default router;
```

Services call Drizzle directly; there is no model layer:

```ts
import { eq } from "drizzle-orm";
import { db } from "@groot/core/database";
import { Boom } from "@groot/core/errors";
import { posts } from "../../db/schema";

export async function findById(id: number) {
  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) throw Boom.notFound("Post not found");
  return post;
}
```

| Helper (`@groot/core/utils/…`)                    | Does                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `parseBody(c, schema)` (async)                    | JSON body through Zod; bad JSON or validation → 400 with field details |
| `parseQuery(c, schema)`, `parseParams(c, schema)` | Query string / route params through Zod                                |
| `parseId(value)`, `parseStringParam(value)`       | Positive integer id / required string param, else 400                  |
| `requireUser(c)`                                  | The JWT user (`{ userId, email }`), else 401                           |
| `clientIp(c)`                                     | `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, or `unknown`       |
| `ok(c, data, status = 200)`, `created(c, data)`   | `{ success: true, data }`                                              |
| `noContent(c)`                                    | 204                                                                    |
| `fail(c, error, status)`                          | `{ success: false, error }` (used by the error handler)                |

Errors: throw `Boom.*` for expected failures (`notFound`, `badRequest`,
`unauthorized`, `conflict`, …). SQLite constraint failures are mapped for you
(`UNIQUE` → 409, `FOREIGN KEY` / `NOT NULL` / `CHECK` → 400). Anything else
logs with breadcrumbs, goes to `reportError()`, and returns a 500 whose message
is only shown in development.

## Database

Drizzle on SQLite, nothing else. `db` from `@groot/core/database` is a live
binding set by `bootstrap()`: better-sqlite3 (sync driver) on Node, D1 (async
driver) on Workers. Code that `await`s the query builder works on both. Rules:
query builder only, no `db.transaction()` (D1 has none), timestamps as
`integer({ mode: "timestamp_ms" })`, JSON as `text({ mode: "json" })`. Tables
live in three schema files; `apps/web/src/server/db/schema.ts` re-exports them
all and is the drizzle-kit entry. See [Database migrations](./database-migrations.md).

## Bootstrap and the two runtimes

`bootstrap({ env, config, db, storage, reportError })` wires, in order, env →
config → logger → db → storage → error reporter. Each entry calls it once:

|          | `entry.node.ts`                                                                               | `entry.worker.ts`                              |
| -------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| env      | `process.env` (+ `.env` via `process.loadEnvFile` when present)                               | Worker vars + secrets bindings                 |
| db       | `createSqliteDb(DATABASE_URL, { migrationsFolder })`, migrates on boot                        | `drizzle(env.DB)` (D1)                         |
| storage  | `localStorage(uploadsRoot(env))` → `/data/uploads` in production, `./local/uploads` otherwise | `r2Storage(env.STORAGE)`                       |
| errors   | `@sentry/node` when `SENTRY_DSN` is set                                                       | `@sentry/cloudflare` `withSentry`              |
| client   | Vite middleware (dev) / `dist/client` + SPA fallback (prod)                                   | Static Assets; `run_worker_first` for `/api/*` |
| jobs     | `startWorkers()` poller                                                                       | `scheduled` handler → `runTick()`              |
| shutdown | `SIGTERM` → `/health` 503 → stop workers → close                                              | n/a                                            |

Core stays runtime-neutral: Web APIs only (`crypto.subtle`, `fetch`,
`TextEncoder`), with `node:` imports confined to `database/node.ts`,
`storage/node.ts`, `node:async_hooks` and `node:buffer` (both provided by
Workers under `nodejs_compat`).

## Storage

`storage` from `@groot/core/storage` is whatever `StorageAdapter` the entry
injected: `put / get / head / delete / list / copy` over `/`-separated keys,
folders as common prefixes. Three adapters ship (local filesystem, R2 bucket
binding, memory for tests); another backend is one file implementing the
interface in `packages/core/src/storage/adapter.ts`. See [File storage](../features/storage.md).

## Background jobs

The `jobs` table is the queue. `addJob()` inserts a row; `runTick()` claims and
runs due rows; the Node poller or the Workers cron trigger calls it. Handlers
register through `registerJobHandlers()` in `apps/web/src/server/app.ts`.
Details in [Background jobs](../features/jobs.md).

## Logging and request context

`logger` from `@groot/core/logger` is a small structured logger:
`logger.info({ userId }, "Signed in")`, `logger.child({ component })`, levels
`trace` … `fatal`. Output is a readable line outside production and JSON lines
in production (`configureLogger` is called by `bootstrap`). The request
context (id, start time, breadcrumbs, `waitUntil`) lives in AsyncLocalStorage:
`addBreadcrumb("auth", "token verified")` records a step that is attached to
the next error log; `waitUntil(promise)` keeps a Workers request alive for
background work and simply detaches on Node. `reportError(error, context)` is
the seam the entries point at Sentry.

## Key-value store

`kv` from `@groot/core/kv` is a JSON key-value API over the `kv` table with
optional TTL; app settings and passkey challenges use it. See [KV](../kv.md).

## Authentication

| Layer     | Routes                                                                         | Requirement                                                                           |
| --------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Public    | `POST /api/v1/auth/login`, `POST /api/v1/passkey/login/*`, `/health`, `/ready` | none (login routes: 20 requests / 15 min per IP)                                      |
| Protected | everything else under `/api/v1`                                                | JWT in the `token` httpOnly cookie or `Authorization: Bearer …` (`jwtAuthMiddleware`) |
| Admin     | `POST` / `GET /api/v1/auth/users`                                              | `X-Admin-Auth-Key` equal to `ADMIN_AUTH_KEY` (`adminAuthMiddleware`)                  |

Passwords are PBKDF2-SHA256 (100,000 iterations through WebCrypto); tokens are
HS256 via jose, valid for `config.auth.jwtExpiresIn` (30 days). Login sets the
cookie and also returns the token for non-browser clients.

## Client

React Router 7 (`apps/web/src/client/App.tsx`), Zustand
(`@groot/shell/store/auth`), React Query + Axios (`@groot/shell/lib/api`,
`baseURL: /api/v1`, sends the cookie, unwraps `data`), `@groot/ui` primitives.
See [Client](../features/client.md).

## Adding a feature

1. Table in `apps/web/src/server/db/schema.ts` → `pnpm db:generate` → commit `apps/web/drizzle/`.
2. `apps/web/src/server/api/<feature>/` with `.schema.ts`, `.service.ts`, `.routes.ts` (+ `.jobs.ts`).
3. Mount the router in `createWebApp()`; register jobs in `registerJobHandlers()`.
4. New env var? Add it to `envSchema` (`packages/core/src/env.ts`) and `.env.example`; expose it through `defaultConfig()` if code needs it.
5. Tests in `tests/server/app/` using `createTestApp()` + `api()`.

Full walkthrough in [Development workflow](./development.md).

## Design principles

| Principle                 | What it means                                                           |
| ------------------------- | ----------------------------------------------------------------------- |
| One app, two entries      | Runtime-specific code lives only in `entry.node.ts` / `entry.worker.ts` |
| Feature isolation         | A feature is one folder: schema, service, routes, jobs                  |
| Parse at the edge         | Zod on every body, query and param; services receive typed data         |
| One envelope              | `ok()` / `noContent()` / thrown `Boom` — never hand-built JSON          |
| The database is the queue | Jobs, schedules, logs, kv are tables, not services                      |
| Boring persistence        | Query builder, no transactions, generated migrations                    |
