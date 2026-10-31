# Sentry source maps

Upload source maps at build time so Sentry shows original TypeScript paths
instead of `dist/server/bundle.js:942:12`.

## Prerequisites

- A Sentry project, its organization slug and project slug
- An auth token with `organization:read`, `project:write`, `release:admin`
  (Sentry → **Settings → Developer Settings → Organization Tokens** for CI, or a
  personal token under **Account Settings → User Auth Tokens**)

Never commit the token; rotate it if it leaks.

## Build-time variables

Set these where the build runs (Coolify → Environment Variables, available at
build time; a CI secret; your shell):

| Variable            | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `SENTRY_AUTH_TOKEN` | Enables the upload plugins                                    |
| `SENTRY_ORG`        | Organization slug (also required for the plugins to activate) |
| `SENTRY_PROJECT`    | Project slug; defaults to the package name (`groot`)          |
| `SENTRY_RELEASE`    | Release name; see below                                       |

Without `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` the plugins are skipped and the
build is a normal build.

## How it works

| Plugin                   | Where               | Uploads                                | Deleted after upload       |
| ------------------------ | ------------------- | -------------------------------------- | -------------------------- |
| `@sentry/esbuild-plugin` | `scripts/build.mjs` | server maps `dist/server/*.map`        | `dist/server/*.map`        |
| `@sentry/vite-plugin`    | `vite.config.ts`    | client maps `dist/client/assets/*.map` | `dist/client/assets/*.map` |

Both compute the release as `SENTRY_RELEASE`, else `<package-name>@<short sha>`
from `SOURCE_COMMIT` / `SOURCE_VERSION` / `git rev-parse HEAD`.

At runtime both entries read `config.sentry`, which `defaultConfig()` fills
from the validated `SENTRY_DSN` and `SENTRY_RELEASE`: the Node entry
initialises `@sentry/node` when the DSN is set, and the Worker passes both to
`@sentry/cloudflare`. The Node bundle bakes the release it uploaded under in as
the default for `SENTRY_RELEASE`; a runtime value still wins. For stack traces to resolve, the
runtime release must equal the uploaded one, so **set `SENTRY_RELEASE`
explicitly in both the build and the runtime environment** (for example
`groot@$(git rev-parse --short HEAD)` in CI) rather than relying on the
fallbacks.

## Verify

1. Build logs show the Sentry plugins uploading artifacts.
2. **Sentry → Releases** lists the release with source map artifacts.
3. Trigger an error; the stack trace shows paths like `packages/core/src/…`.

## Troubleshooting

- **Nothing uploaded** — the token or `SENTRY_ORG` is missing at build time,
  or the token lacks scopes.
- **Still bundled paths** — the runtime release does not match the uploaded
  release (`SENTRY_RELEASE` differs or is unset on one side), or processing is
  still in progress.
- **Workers** — the client maps are uploaded by `pnpm build:client`
  (run by `pnpm deploy:worker`); the Worker bundle itself is built by wrangler,
  which has its own `upload_source_maps` option in `wrangler.jsonc` if you want
  server-side maps there too.
