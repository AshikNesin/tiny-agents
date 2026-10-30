# Documentation

The documentation hub for groot: a minimal Hono + React + Drizzle boilerplate
on SQLite that runs on Node or Cloudflare Workers. Start with the quick start,
then read the guides and feature docs as you need them.

## Getting started

| Document                                                 | What it covers                                        |
| -------------------------------------------------------- | ----------------------------------------------------- |
| [`quick-start.md`](./quick-start.md)                     | Boot the app, sign in, add your first feature         |
| [`setup-guide.md`](./setup-guide.md)                     | Prerequisites, every environment variable, prod build |
| [`guides/portless-https.md`](./guides/portless-https.md) | Local HTTPS via portless, certificate trust           |

## Guides

| Document                                                           | What it covers                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| [`guides/architecture.md`](./guides/architecture.md)               | `createApp()`, `bootstrap()`, request flow, the two runtimes   |
| [`guides/development.md`](./guides/development.md)                 | Commands, conventions, adding a feature end to end             |
| [`guides/database-migrations.md`](./guides/database-migrations.md) | Drizzle schema files, `pnpm db:generate`, how migrations apply |
| [`guides/testing.md`](./guides/testing.md)                         | In-process Hono tests on in-memory SQLite, Playwright, CI      |
| [`guides/deploy.md`](./guides/deploy.md)                           | Node deploy with Railpack (Coolify/Railway), volume, env vars  |
| [`guides/deploy-cloudflare.md`](./guides/deploy-cloudflare.md)     | Workers + D1 + R2 + cron on the free plan, step by step        |
| [`config.md`](./config.md)                                         | `AppConfig` defaults and `defineConfig()` overrides            |
| [`precommit-hooks.md`](./precommit-hooks.md)                       | gitleaks secret detection + Vite+ staged lint/format           |

## Features

| Document                                                                     | What it covers                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`features/todos.md`](./features/todos.md)                                   | The reference feature module (table, routes, service, jobs) |
| [`features/jobs.md`](./features/jobs.md)                                     | Table-backed job queue: handlers, `runTick()`, HTTP API, UI |
| [`features/client.md`](./features/client.md)                                 | Client routing, auth guard, data fetching, UI rules         |
| [`features/storage.md`](./features/storage.md)                               | File browser over a storage adapter: local disk, R2, memory |
| [`features/passkey-authentication.md`](./features/passkey-authentication.md) | WebAuthn passkeys                                           |
| [`features/ai-inference.md`](./features/ai-inference.md)                     | Unified LLM API with Zod structured output                  |
| [`features/dls.md`](./features/dls.md)                                       | Design language system and its enforcement                  |
| [`features/connections.md`](./features/connections.md)                       | tiny-agents: MCP servers, per-tool switches, tool page      |
| [`features/chat-attachments.md`](./features/chat-attachments.md)             | tiny-agents: attachments, vision, bots reading files        |
| [`features/questions.md`](./features/questions.md)                           | tiny-agents: bots ask the owner clarifying questions        |
| [`features/routines.md`](./features/routines.md)                             | tiny-agents: where routine runs happen, result cards        |
| [`features/past-chats.md`](./features/past-chats.md)                         | tiny-agents: read, continue or delete earlier chats         |
| [`features/notifications.md`](./features/notifications.md)                   | tiny-agents: Pushover pushes when a bot needs you           |
| [`features/auto-review.md`](./features/auto-review.md)                       | tiny-agents: a classifier approves low-risk asks            |
| [`features/terminal.md`](./features/terminal.md)                             | tiny-agents: xterm tabs on the sandbox VM                   |
| [`features/vault.md`](./features/vault.md)                                   | tiny-agents: logins, cards, 2FA and API keys for bots       |
| [`kv.md`](./kv.md)                                                           | Key-value store on the `kv` table                           |

## Reference

| Document                                                 | What it covers                                       |
| -------------------------------------------------------- | ---------------------------------------------------- |
| [`examples/api-requests.md`](./examples/api-requests.md) | Copy-ready `curl` recipes with expected status codes |
| [`sync-guide.md`](./sync-guide.md)                       | Keeping child projects in sync with the boilerplate  |
| [`sentry-source-maps.md`](./sentry-source-maps.md)       | Source map uploads for readable Sentry traces        |
| [`adr/`](./adr/README.md)                                | Architecture decision records (the _why_)            |
| [`../scripts/demo/README.md`](../scripts/demo/README.md) | tiny-agents: the demo video and how to re-record it  |
| [`CHANGELOG.md`](./CHANGELOG.md)                         | Documentation changes over time                      |

## Tech stack at a glance

| Area    | Tech                                                                     |
| ------- | ------------------------------------------------------------------------ |
| Server  | Hono 4, TypeScript, Drizzle ORM, SQLite (better-sqlite3 / D1), Zod, jose |
| Client  | React 19, Vite+, React Router 7, React Query, Zustand, Tailwind v4       |
| Auth    | JWT (cookie or bearer) + passkeys (WebAuthn)                             |
| Runtime | Node 24 (`@hono/node-server`) or Cloudflare Workers (`wrangler`)         |
| Tooling | Vite+ (Oxlint/Oxfmt), Vitest, Playwright, pnpm                           |

## API surface

| Prefix             | Purpose                                 | Auth                                   |
| ------------------ | --------------------------------------- | -------------------------------------- |
| `/api/v1/auth`     | Login, logout, current user, users      | Public login · JWT · admin key (users) |
| `/api/v1/passkey`  | Passkey registration, login, management | Public login · JWT                     |
| `/api/v1/todos`    | Todo CRUD (reference feature)           | JWT                                    |
| `/api/v1/jobs`     | Job queue management + dashboard API    | JWT                                    |
| `/api/v1/storage`  | File operations                         | JWT                                    |
| `/api/v1/settings` | App key-value settings                  | JWT                                    |
| `GET /health`      | Liveness (503 while shutting down)      | None                                   |
| `GET /ready`       | Readiness                               | None                                   |

Every JSON response uses the envelope `{ success, data }` or
`{ success: false, error: { code, message, details } }`.
