# Deploying on Node (Railpack: Coolify, Railway)

The Node build is one process: `node dist/server/bundle.js` serves the API and
the built client, applies migrations on boot and runs the job poller. SQLite
lives in a file, so the host needs a persistent disk and exactly one replica.
For a disk-less, free deploy use [Cloudflare Workers](./deploy-cloudflare.md).

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
server migrates itself before it listens. `better-sqlite3` is the only native
module and is installed on the host by `pnpm install`.

## Coolify

1. **+ New Resource → Application**, pick the repo, **Build Pack → Railpack**.
2. **Persistent Storage**: a volume mounted at `/data`. Production stores the
   database at `/data/prod.db` and uploads at `/data/uploads` by default, so
   no `DATABASE_URL` is needed. Without the volume the data is lost on
   every redeploy. Mount it outside the app directory (Railpack builds into
   `/app`): a path like `/app/data` depends on the build's working directory
   and hides the repo's own `data/` folder. Set **Container naming** to a consistent name (no rolling
   updates): two processes must never share the SQLite file.
3. **Environment variables** (table below).
4. **Deploy.** Point the healthcheck at `/health` (returns 503 while shutting
   down) or `/ready`.

## Production environment

| Variable               | Required | Value                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------- |
| `NODE_ENV`             | yes      | `production`                                                        |
| `DATABASE_URL`         | no       | defaults to `file:/data/prod.db` (on the volume)                    |
| `UPLOADS_DIR`          | no       | defaults to `/data/uploads` (next to the database)                  |
| `JWT_SECRET_KEY`       | yes      | ≥ 32 random characters                                              |
| `ADMIN_AUTH_KEY`       | yes      | random; the `X-Admin-Auth-Key` header for user management           |
| `RP_ID`, `ORIGIN`      | yes      | `app.example.com`, `https://app.example.com` (passkeys)             |
| `RP_NAME`              | no       | name shown in passkey prompts                                       |
| `CORS_ALLOWED_ORIGINS` | no       | only when another origin calls the API                              |
| `SENTRY_DSN`           | no       | error reporting; see [Sentry source maps](../sentry-source-maps.md) |
| `PORT`                 | injected | the platform sets it; do not override                               |

The server refuses to start in production with the development fallbacks or
with any of the required variables missing, and lists what is wrong.

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

- **Uploads** go to `/data/uploads` in production (beside the database) and to
  `./local/uploads` otherwise. Set `UPLOADS_DIR` to move them.
- **Graceful shutdown**: on `SIGTERM` the server flips `/health` to 503, waits
  two seconds for the load balancer, stops the job poller (waiting for the
  in-flight tick), closes the listener and exits.
- **Scaling**: one replica. The poller, the SQLite file and in-memory rate
  limits all assume a single process. Need more? That is what the Workers
  target is for.
- **Cron jobs**: schedules live in the database (`POST /api/v1/jobs/schedule`)
  and survive redeploys.
- **Heroku-style buildpacks** that set `NPM_CONFIG_LOGLEVEL=error` hide pnpm
  lifecycle output; set it to `notice` to see why a build step failed.
