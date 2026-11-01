# Documentation

The documentation hub for tiny-agents and the groot boilerplate it is built
on (Hono + React + Drizzle on SQLite; tiny-agents runs on Node only). Start
with the quick start, then read the guides and feature docs as you need
them. The tech stack and workspace layout are in the
[root README](../README.md).

## Getting started

| Document                             | What it covers                                        |
| ------------------------------------ | ----------------------------------------------------- |
| [`quick-start.md`](./quick-start.md) | Boot the app, sign in, add your first feature         |
| [`setup-guide.md`](./setup-guide.md) | Prerequisites, every environment variable, prod build |

## Guides

How to work on and ship the app.

| Document                                                           | What it covers                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------- |
| [`guides/architecture.md`](./guides/architecture.md)               | `createApp()`, `bootstrap()`, request flow, the two runtimes   |
| [`guides/development.md`](./guides/development.md)                 | Commands, conventions, adding a feature end to end             |
| [`guides/database-migrations.md`](./guides/database-migrations.md) | Drizzle schema files, `pnpm db:generate`, how migrations apply |
| [`guides/testing.md`](./guides/testing.md)                         | In-process Hono tests on in-memory SQLite, Playwright, CI      |
| [`guides/portless-https.md`](./guides/portless-https.md)           | Local HTTPS via portless, certificate trust                    |
| [`guides/precommit-hooks.md`](./guides/precommit-hooks.md)         | gitleaks secret detection + Vite+ staged lint/format           |
| [`guides/deploy.md`](./guides/deploy.md)                           | Node deploy with Railpack (Coolify/Railway), volume, env vars  |
| [`guides/deploy-cloudflare.md`](./guides/deploy-cloudflare.md)     | groot's Workers target (not used: tiny-agents is Node only)    |
| [`guides/sentry-source-maps.md`](./guides/sentry-source-maps.md)   | Source map uploads for readable Sentry traces                  |
| [`guides/sync.md`](./guides/sync.md)                               | Keeping child projects in sync with the boilerplate            |

## Features

What ships in the box and how to use or extend it.

| Document                                                                     | What it covers                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`features/todos.md`](./features/todos.md)                                   | The reference feature module (table, routes, service, jobs) |
| [`features/jobs.md`](./features/jobs.md)                                     | Table-backed job queue: handlers, `runTick()`, HTTP API, UI |
| [`features/storage.md`](./features/storage.md)                               | File browser over a storage adapter: local disk, R2, memory |
| [`features/kv.md`](./features/kv.md)                                         | Key-value store on the `kv` table                           |
| [`features/passkey-authentication.md`](./features/passkey-authentication.md) | WebAuthn passkeys                                           |
| [`features/ai-inference.md`](./features/ai-inference.md)                     | Unified LLM API with Zod structured output                  |
| [`features/client.md`](./features/client.md)                                 | Client routing, auth guard, data fetching, API client       |
| [`features/dls.md`](./features/dls.md)                                       | Design language system and its enforcement                  |
| [`features/connections.md`](./features/connections.md)                       | tiny-agents: MCP servers, per-tool switches, tool page      |
| [`features/chat-attachments.md`](./features/chat-attachments.md)             | tiny-agents: attachments, vision, bots reading files        |
| [`features/questions.md`](./features/questions.md)                           | tiny-agents: bots ask the owner clarifying questions        |
| [`features/routines.md`](./features/routines.md)                             | tiny-agents: where routine runs happen, result cards        |
| [`features/past-chats.md`](./features/past-chats.md)                         | tiny-agents: read, continue or delete earlier chats         |
| [`features/notifications.md`](./features/notifications.md)                   | tiny-agents: Pushover pushes when a bot needs you           |
| [`features/auto-review.md`](./features/auto-review.md)                       | tiny-agents: a classifier approves low-risk asks            |
| [`features/terminal.md`](./features/terminal.md)                             | tiny-agents: xterm tabs on the sandbox VM                   |
| [`features/computer.md`](./features/computer.md)                             | tiny-agents: a desktop per bot on the sandbox VM, live view |
| [`features/vault.md`](./features/vault.md)                                   | tiny-agents: logins, cards, 2FA and API keys for bots       |

## Reference

Lookup material.

| Document                                                   | What it covers                                       |
| ---------------------------------------------------------- | ---------------------------------------------------- |
| [`reference/config.md`](./reference/config.md)             | `AppConfig` defaults and `defineConfig()` overrides  |
| [`reference/api-requests.md`](./reference/api-requests.md) | Copy-ready `curl` recipes with expected status codes |
| [`adr/`](./adr/README.md)                                  | Architecture decision records (the _why_)            |
| [`../scripts/demo/README.md`](../scripts/demo/README.md)   | tiny-agents: the demo video and how to re-record it  |

## API surface

| Prefix                                                                        | Purpose                                                | Auth                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- |
| `/api/v1/auth`                                                                | Login, logout, current user, users                     | Public login · JWT · admin key (users) |
| `/api/v1/passkey`                                                             | Passkey registration, login, management                | Public login · JWT                     |
| `/api/v1/bots`, `/api/v1/models`, `/api/v1/events`                            | tiny-agents: bots, chats (SSE), past chats, browser    | JWT                                    |
| `/api/v1/tasks`, `/api/v1/routines`, `/api/v1/skills`                         | tiny-agents: tasks, routines, the skills library       | JWT                                    |
| `/api/v1/connections`, `/api/v1/vault`, `/api/v1/uploads`, `/api/v1/terminal` | tiny-agents: MCP servers, vault, attachments, terminal | JWT                                    |
| `/api/v1/notifications`                                                       | tiny-agents: push notification settings and status     | JWT                                    |
| `/api/v1/jobs`                                                                | Job queue management + dashboard API                   | JWT                                    |
| `/api/v1/storage`                                                             | File operations                                        | JWT                                    |
| `/api/v1/settings`                                                            | App key-value settings                                 | JWT                                    |
| `GET /health`                                                                 | Liveness (503 while shutting down)                     | None                                   |
| `GET /ready`                                                                  | Readiness                                              | None                                   |

Every JSON response uses the envelope `{ success, data }` or
`{ success: false, error: { code, message, details } }`.

## Where new docs go

- **Getting started** (root): only the first-run path.
- **`guides/`**: a task you perform (develop, test, deploy, sync).
- **`features/`**: one shipped capability, how it works and how to extend it.
- **`reference/`**: tables and recipes you look things up in.
- **`adr/`**: why a decision was made. Add one with the `domain-modeling` skill's ADR format.

Link to the doc that owns a topic instead of repeating it: env vars live in
the setup guide, config defaults in `reference/config.md`, `curl` recipes in
`reference/api-requests.md`.
