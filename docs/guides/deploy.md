# Deploying on Node (Railpack: Coolify, Railway)

The Node build is one process: `node dist/server/bundle.js` serves the API and
the built client, applies migrations on boot and runs the job poller. SQLite
lives in a file, so the host needs a persistent disk and exactly one replica.
tiny-agents also runs the pi-durable agent store in the same process (a second
SQLite file) and drives Chromium, so it deploys on Node only; groot's Workers
target does not apply.

## What Railpack detects

| Signal          | Source                                                          |
| --------------- | --------------------------------------------------------------- |
| Runtime         | `package.json` → `engines.node` (24.x)                          |
| Package manager | `package.json` → `packageManager` (pnpm 10)                     |
| Install         | `pnpm install --frozen-lockfile`                                |
| Build           | `package.json` → `scripts.build`                                |
| Start           | `Procfile` → `web: pnpm start` (also pinned in `railpack.json`) |

`pnpm build` runs Vite (client → `dist/client`) and esbuild (server →
`dist/server/bundle.js`, workspace packages inlined, npm dependencies
external) and copies `apps/web/drizzle` to `dist/server/drizzle`. `pnpm start`
boots the bundle with `NODE_ENV=production`; there is no `prestart` step, the
server migrates itself before it listens. `better-sqlite3` and `ssh2` are
native modules installed on the host by `pnpm install`. `railpack.json` adds
the `chromium` apt package to the runtime image for the browser toolkit.

## Coolify

1. **+ New Resource → Application**, pick the repo, **Build Pack → Railpack**.
2. **Persistent Storage**: one volume holding both SQLite files. tiny-agents'
   existing deploy mounts it at `/app/data` and sets
   `DATABASE_URL=file:/app/data/app.db` and `AGENT_DB_PATH=/app/data/agent.db`;
   uploads then live in `/app/data/uploads`. Without those variables
   production defaults to `/data/app.db`, `/data/agent.db` and
   `/data/uploads`, so a volume at `/data` also works. Without a volume the
   data is lost on every redeploy. Set **Container naming** to a consistent
   name (no rolling updates): two processes must never share the SQLite files,
   and pi-durable allows only one process per agent store.
3. **Environment variables** (table below).
4. **Deploy.** Point the healthcheck at `/health` (returns 503 while shutting
   down) or `/ready`.

## Production environment

| Variable               | Required | Value                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| `NODE_ENV`             | yes      | `production`                                                        |
| `DATABASE_URL`         | no       | defaults to `file:/data/app.db` (on the volume)                     |
| `AGENT_DB_PATH`        | no       | defaults to `/data/agent.db` (pi-durable store, same volume)        |
| `UPLOADS_DIR`          | no       | defaults to `/data/uploads` (next to the database)                  |
| `JWT_SECRET_KEY`       | yes      | ≥ 32 random characters                                              |
| `ADMIN_AUTH_KEY`       | yes      | random; the `X-Admin-Auth-Key` header for user management           |
| `RP_ID`, `ORIGIN`      | yes      | `app.example.com`, `https://app.example.com` (passkeys)             |
| `RP_NAME`              | no       | name shown in passkey prompts                                       |
| `CORS_ALLOWED_ORIGINS` | no       | only when another origin calls the API                              |
| `SENTRY_DSN`           | no       | error reporting (defaults to tiny-agents' project DSN)              |
| `PORT`                 | injected | the platform sets it; do not override                               |

The server refuses to start in production with the development fallbacks or
with any of the required variables missing, and lists what is wrong.
tiny-agents' own variables (gateway, sandbox, vault, browser) are listed in
`.env.example`.

## Upgrading from the Prisma build

The first boot of this build on a database from the Prisma era renames it to
`app.db.prisma-backup-<time>` (next to it, on the volume) and copies every
row into the new layout: users, passkeys, bots, past chats, skills,
connections, messages, tasks, vault items and audit events, uploads,
routines and their runs, memories, the notification log and the key-value
settings. Routines re-arm their next run on boot. Old bcrypt passwords keep
working and are re-hashed on the first sign-in. Files the old build kept in
`./local/uploads` are copied to the new uploads folder if they are still
there. Keep the backup until you have checked the app.

## First user

`pnpm db:seed` is for local development. In production create the first user
through the admin API:

```bash
curl -X POST https://app.example.com/api/v1/auth/users \
  -H "Content-Type: application/json" \
  -H "X-Admin-Auth-Key: $ADMIN_AUTH_KEY" \
  -d '{"email":"you@example.com","password":"a-long-password","name":"You"}'
```

## Notes

- **Uploads** go to `uploads/` beside the database in production and to
  `./local/uploads` otherwise. Set `UPLOADS_DIR` to move them.
- **Graceful shutdown**: on `SIGTERM` the server flips `/health` to 503, waits
  two seconds for the load balancer, stops the job poller (waiting for the
  in-flight tick), closes the listener and exits.
- **Scaling**: one replica. The poller, the SQLite files, the agent store and
  in-memory rate limits all assume a single process.
- **Cron jobs**: schedules live in the database (`POST /api/v1/jobs/schedule`)
  and survive redeploys.
- **Heroku-style buildpacks** that set `NPM_CONFIG_LOGLEVEL=error` hide pnpm
  lifecycle output; set it to `notice` to see why a build step failed.
