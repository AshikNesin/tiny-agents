# Setup guide

Everything needed to run the API, job queue and React client locally and in
production, on Node.

## Prerequisites

- **Node.js 24** (`engines` in `package.json`) and **pnpm**.
- Optional: **portless**, installed globally (`npm install -g portless`). When
  it is installed, `pnpm dev` runs through it to serve
  `https://tiny-agents.localhost`; without it, or with `PORTLESS=0`, the app is
  at `http://localhost:3000`. See [Portless & HTTPS](./guides/portless-https.md).
- Nothing for the database: SQLite ships inside `better-sqlite3`.

## Zero-config development

```bash
pnpm install
pnpm dev
```

Every environment variable has a development default, so no `.env` is needed.
To override, copy `.env.example` to `.env` (git-ignored); `pnpm dev`,
`pnpm db:seed`, `pnpm db:migrate` and `entry.node.ts` load it with
`process.loadEnvFile` when present. Sign in with
`demo@example.com` / `demo@example.com`.

## Environment variables

Validated once at boot by `parseEnv()` in `packages/core/src/env.ts`; the same
schema reads `process.env`. Empty strings count
as unset. In production (`NODE_ENV=production`) the variables marked
**required** must be set and the development fallbacks are refused.

| Variable                                                             | Dev default                                     | Production                    | Notes                                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                           | `development`                                   | `production`                  | `test` is set by the test setup                                                                                                          |
| `DATABASE_URL`                                                       | `file:./data/dev.db`                            | `file:/data/app.db` (default) | `:memory:` is accepted. Unset in production, it is `app.db` under `DATA_DIR`                                                             |
| `UPLOADS_DIR`                                                        | `./local/uploads`                               | `/data/uploads` (default)     | Uploads folder. Production default sits beside the database                                                                              |
| `DATA_DIR`                                                           | unused                                          | `/data` (default)             | Production folder for `app.db`, `agent.db` and `uploads/` when their own variables are unset                                             |
| `PORT`                                                               | `3000`                                          | injected by the host          | Node only                                                                                                                                |
| `JWT_SECRET_KEY`                                                     | dev-only fallback                               | **required**, ≥ 32 characters | HS256 signing key                                                                                                                        |
| `ADMIN_AUTH_KEY`                                                     | dev-only fallback                               | **required**                  | Value of the `X-Admin-Auth-Key` header                                                                                                   |
| `RP_NAME`                                                            | `Groot`                                         | optional                      | Passkey display name                                                                                                                     |
| `RP_ID`                                                              | `localhost`                                     | **required**, your domain     | Passkey relying party id; under portless see [Portless & HTTPS](./guides/portless-https.md)                                              |
| `ORIGIN`                                                             | `http://localhost:3000`                         | **required**, `https://…`     | Passkey origin; must be a URL                                                                                                            |
| `CORS_ALLOWED_ORIGINS`                                               | empty (reflects the requesting origin)          | comma-separated list          | Only needed for cross-origin callers                                                                                                     |
| `TRUSTED_PROXIES`                                                    | loopback and private networks                   | optional; `none` trusts none  | Proxies whose `X-Forwarded-For` names the client for rate limits and logs: IPv4 or IPv6 addresses or ranges. A list replaces the default |
| `LOG_LEVEL`                                                          | `debug` (dev) / `info` (prod) / `silent` (test) | optional                      | `trace` `debug` `info` `warn` `error` `fatal` `silent`                                                                                   |
| `SENTRY_DSN`, `SENTRY_RELEASE`                                       | unset                                           | optional                      | Error reporting through `config.sentry`; see [Sentry source maps](./guides/sentry-source-maps.md)                                        |
| `SENTRY_ORG`, `SENTRY_AUTH_TOKEN`, `SENTRY_PROJECT`, `SOURCE_COMMIT` | unset                                           | build-time only               | Source map upload and the release name; not part of `envSchema`                                                                          |
| `PUSHOVER_USER_KEY`, `PUSHOVER_API_TOKEN`                            | unset                                           | optional                      | Push notification when the Node server starts in production                                                                              |

Non-secret settings (rate limits, job tuning, ...) are derived from these in
`packages/core/src/config.ts` and overridden in `apps/web/src/server/config.ts`;
[Config](./reference/config.md#env-vs-config) covers that split and what adding
a variable involves.

The table above covers the core (groot) variables. tiny-agents adds its own —
the sandbox VM, the browser and computer toolkits, the secrets key, 1Password
Connect, TinyFish
web search, the faux model, `AUTH_RATE_LIMIT_MAX` for test
servers — each with a comment in
[`.env.example`](../.env.example), validated in `apps/web/src/server/env.ts`.
All are optional in development.

Models are not env: add provider accounts and their keys in **Settings →
Models** after first sign-in, with no restart. Keys are kept in the vault, so
set `SECRETS_KEY` first. See [Models](./features/models.md).

Coding agents (optional): `SHELLEY_URL` adds Shelley to the Code page;
a Claude plan account (Settings → Models) with a sandbox adds Claude Code. Without either,
the Code page and the bots' `code_*` tools stay off. See [Code](./features/code.md).

Claude plan (experimental, off by default): add a Claude plan account in
Settings → Models; the app sets Claude Code up on the sandbox and you sign
in from Settings → Models → Claude plan. Its fallback model is optional.
The token is the worker's bearer, not a Claude credential. See
[Use your Claude subscription](./claude-subscription.md).

Generate secrets with `openssl rand -base64 48 | tr -d '/+=' | cut -c1-48`.

## Local development

```bash
pnpm dev                 # http://localhost:3000, or https://tiny-agents.localhost[:8888] with portless; migrates + seeds first
PORTLESS=0 pnpm dev      # http://localhost:3000 even with portless installed
```

`pnpm dev` runs `scripts/dev.ts`: seed (which applies migrations), then
`tsx watch apps/web/src/server/entry.node.ts`. In development the Node entry
runs Vite in middleware mode, so the client has HMR on the same port as the API.
`GET /health` confirms the API is up.

## Production build (Node)

```bash
pnpm build        # dist/client (Vite) + dist/server/bundle.js (esbuild) + dist/server/drizzle
pnpm start        # node dist/server/bundle.js with NODE_ENV=production
```

The bundle applies pending migrations on boot, serves `dist/client` with an
SPA fallback (hashed assets cached for a year), starts the job poller, and
shuts down gracefully on `SIGTERM` (flips `/health` to 503, waits for the
in-flight job tick). Workspace packages are inlined; npm dependencies and
`better-sqlite3` stay external and come from `pnpm install --prod` on the host.
See [Deploy on Node](./guides/deploy.md).

On your own machine, `pnpm local` does both and keeps the server up to date
from git, with an **Update & restart** button in Settings → Updates. See
[Local updates](./guides/local-updates.md).

## Database

One engine, SQLite, through Drizzle. The schema is TypeScript
(`packages/core/src/database/schema.ts`, `packages/jobs/src/server/schema.ts`,
`apps/web/src/server/db/schema.ts`); migrations are generated SQL in
`apps/web/drizzle/`, applied automatically by the Node server at boot. See [Database migrations](./guides/database-migrations.md).

## Background jobs

No broker: the `jobs` table is the queue. The Node entry starts a poller
(`startWorkers()`).
Tuning lives in `config.jobs` ([Config](./reference/config.md)); the API and handler model
in [Background jobs](./features/jobs.md).

## Verify the stack

```bash
BASE=https://tiny-agents.localhost   # http://localhost:3000 under PORTLESS=0
curl $BASE/health
TOKEN=$(curl -s -X POST $BASE/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"demo@example.com"}' | jq -r .data.token)
curl -H "Authorization: Bearer $TOKEN" $BASE/api/v1/tasks
```

A `200` with the task list from the last call confirms the API, database and
JWT guard are all working.
