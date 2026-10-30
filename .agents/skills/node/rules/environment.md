---
name: environment
description: Environment configuration and secrets management
metadata:
  tags: environment, configuration, env, secrets
---

# Environment configuration

## Project approach: one Zod schema, zero-config development

Environment variables are validated once at boot by `parseEnv()` in
`packages/core/src/env.ts`. The same schema runs on Node (`process.env`) and on
Cloudflare Workers (the bindings object), so there is no env loader, no
generated types and no second schema file: `.env.example` documents every
variable and is the only other place a variable is listed.

- Every variable has a development default, including the two dev-only
  secrets in `DEV_DEFAULTS` (`JWT_SECRET_KEY`, `ADMIN_AUTH_KEY`): a fresh
  checkout boots with no `.env` at all.
- `NODE_ENV=production` requires `JWT_SECRET_KEY` (≥ 32 characters),
  `ADMIN_AUTH_KEY`, `ORIGIN` and `RP_ID`, and refuses the development fallbacks.
- Empty strings count as unset (hosting platforms often set unused vars to `""`).
- A validation failure lists every problem and aborts boot.

### Reading values

```ts
import { env } from "@groot/core/env";
import { config } from "@groot/core/config";

export function signingKey() {
  return env.JWT_SECRET_KEY; // read inside functions, not at module top level
}

export function pollInterval() {
  return config.jobs.pollIntervalSeconds; // behaviour comes from config, not raw env
}
```

`env` and `config` are live bindings that `bootstrap()` replaces before the
first request; a module-level read sees the development defaults. Use `env`
for secrets and raw deployment facts, `config.*` for everything that
influences behaviour.

### Adding a variable

1. Add it to `envSchema` in `packages/core/src/env.ts` with `.default()` or
   `.optional()`. If production must set it, enforce that in `parseEnv()` next
   to `ORIGIN` / `RP_ID`.
2. Document it in `.env.example` (mark it `[prod-required]` when it is).
3. If it configures behaviour, surface it through `defaultConfig()` in
   `packages/core/src/config.ts` and read `config.x` in code.
4. On Cloudflare: non-secret → `vars` in `wrangler.jsonc`; secret →
   `pnpm exec wrangler secret put NAME`.

### Where values come from

| Runtime    | Source                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Node, dev  | `.env` if present (`process.loadEnvFile` in `apps/web/src/server/entry.node.ts`), else defaults |
| Node, prod | The platform's environment variables; no `.env` file                                            |
| Workers    | `vars` + secrets bindings; `.dev.vars` (git-ignored) for `wrangler dev`                         |
| Tests      | `tests/server/setup.ts` passes `{ ...process.env, NODE_ENV: "test", DATABASE_URL: ":memory:" }` |
| Scripts    | `scripts/seed.ts`, `scripts/db-migrate.ts` read `process.env` directly                          |

## Secrets

- Never commit them. `.env`, `.env.*` and `.dev.vars` are git-ignored, and the
  pre-commit hook runs gitleaks.
- Generate: `openssl rand -base64 48 | tr -d '/+=' | cut -c1-48`.
- Rotate immediately if one leaks.
- In production inject them as environment variables from the platform's
  secret store (Coolify/Railway variables, Cloudflare `wrangler secret`,
  GitHub Actions secrets).

## `NODE_ENV` belongs to infrastructure

`NODE_ENV` is checked in a handful of infrastructure places: production
strictness in `parseEnv()`, defaults in `defaultConfig()` (log level, jobs off
in tests), cookie flags, error-detail hiding, and the Node entry's dev/prod
server choice. Feature code should not branch on it; add a `config` setting
instead and branch on that.
