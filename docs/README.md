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

| Document                                                           | What it covers                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`guides/architecture.md`](./guides/architecture.md)               | `createApp()`, `bootstrap()`, request flow, the two runtimes     |
| [`guides/development.md`](./guides/development.md)                 | Commands, conventions, adding a feature end to end               |
| [`guides/database-migrations.md`](./guides/database-migrations.md) | Drizzle schema files, `pnpm db:generate`, how migrations apply   |
| [`guides/testing.md`](./guides/testing.md)                         | In-process Hono tests on in-memory SQLite, Playwright, CI        |
| [`guides/portless-https.md`](./guides/portless-https.md)           | Local HTTPS via portless, certificate trust                      |
| [`guides/precommit-hooks.md`](./guides/precommit-hooks.md)         | gitleaks secret detection + Vite+ staged lint/format             |
| [`guides/deploy.md`](./guides/deploy.md)                           | Node deploy with Railpack (Coolify/Railway), volume, env vars    |
| [`guides/local-sandbox.md`](./guides/local-sandbox.md)             | The sandbox VM as a Docker container, for machines off Tailscale |
| [`guides/local-updates.md`](./guides/local-updates.md)             | `pnpm local`: run on your machine, update from Settings          |
| [`guides/sentry-source-maps.md`](./guides/sentry-source-maps.md)   | Source map uploads for readable Sentry traces                    |
| [`guides/sync.md`](./guides/sync.md)                               | Keeping child projects in sync with the boilerplate              |

## Features

What ships in the box and how to use or extend it.

| Document                                                                     | What it covers                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`features/jobs.md`](./features/jobs.md)                                     | Table-backed job queue: handlers, `runTick()`, HTTP API, UI                       |
| [`features/storage.md`](./features/storage.md)                               | File browser over a storage adapter: local disk, memory                           |
| [`features/kv.md`](./features/kv.md)                                         | Key-value store on the `kv` table                                                 |
| [`features/passkey-authentication.md`](./features/passkey-authentication.md) | WebAuthn passkeys                                                                 |
| [`claude-subscription.md`](./claude-subscription.md)                         | Claude Pro/Max through Claude Code: enable, sign in, use                          |
| [`features/models.md`](./features/models.md)                                 | tiny-agents: provider accounts, model rows, model roles                           |
| [`features/client.md`](./features/client.md)                                 | Client routing, auth guard, data fetching, API client                             |
| [`features/dls.md`](./features/dls.md)                                       | Design language system and its enforcement                                        |
| [`features/connections.md`](./features/connections.md)                       | tiny-agents: MCP servers, per-tool switches, tool page                            |
| [`features/chat-attachments.md`](./features/chat-attachments.md)             | tiny-agents: attachments, vision, bots reading files                              |
| [`features/message-steering.md`](./features/message-steering.md)             | tiny-agents: steering a running reply; queued follow-ups                          |
| [`features/memory.md`](./features/memory.md)                                 | tiny-agents: per-bot long-term memory, capture off the reply path                 |
| [`features/questions.md`](./features/questions.md)                           | tiny-agents: bots ask the owner clarifying questions                              |
| [`features/self-improve.md`](./features/self-improve.md)                     | tiny-agents: bots edit their own instructions, owner-gated                        |
| [`features/bot-builder.md`](./features/bot-builder.md)                       | tiny-agents: a bot creates a new bot when asked, owner-gated                      |
| [`features/routines.md`](./features/routines.md)                             | tiny-agents: the reference feature module; where routine runs happen              |
| [`features/past-chats.md`](./features/past-chats.md)                         | tiny-agents: read, continue or delete earlier chats                               |
| [`features/notifications.md`](./features/notifications.md)                   | tiny-agents: Pushover pushes when a bot needs you                                 |
| [`features/auto-review.md`](./features/auto-review.md)                       | tiny-agents: a classifier approves low-risk asks                                  |
| [`features/yolo-mode.md`](./features/yolo-mode.md)                           | tiny-agents: a chat runs its tools without asking (not vault)                     |
| [`features/browser.md`](./features/browser.md)                               | tiny-agents: a real Chrome per bot, live view and takeover                        |
| [`features/terminal.md`](./features/terminal.md)                             | tiny-agents: xterm tabs on the sandbox VM                                         |
| [`features/computer.md`](./features/computer.md)                             | tiny-agents: a desktop per bot on the sandbox VM, live view                       |
| [`features/code.md`](./features/code.md)                                     | tiny-agents: coding agents (Shelley, Claude Code), harness adapters, bot hand-off |
| [`bot-to-bot-contract.md`](./bot-to-bot-contract.md)                         | tiny-agents: cross-bot delivery over the `BotMessage` ledger                      |
| [`features/vault.md`](./features/vault.md)                                   | tiny-agents: logins, cards, 2FA and API keys for bots                             |
| [`features/shared-bots.md`](./features/shared-bots.md)                       | tiny-agents: chat with a guest and a bot together                                 |

## Reference

Lookup material.

| Document                                                       | What it covers                                        |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| [`reference/config.md`](./reference/config.md)                 | `AppConfig` defaults and `defineConfig()` overrides   |
| [`reference/api-requests.md`](./reference/api-requests.md)     | Copy-ready `curl` recipes with expected status codes  |
| [`reference/state-machines.md`](./reference/state-machines.md) | Every stored lifecycle: states, moves, guarded writes |
| [`adr/`](./adr/README.md)                                      | Architecture decision records (the _why_)             |
| [`../scripts/demo/README.md`](../scripts/demo/README.md)       | tiny-agents: the demo video and how to re-record it   |

## `@tiny-agents/agent` entry points

`packages/agent` is the only module that touches pi-durable. Its root is that
boundary; the areas that do not use pi-durable have their own subpaths, so a
change to the terminal or a transport does not churn the root. Each subpath
is an entry file under `packages/agent/src/subpaths/`, listed in the
package's `exports` and in the root `tsconfig.json` `paths` (which the server
build also resolves through). No subpath loads pi-durable code: the URL
guards the browser and the web toolkit share live in `toolkits/public-url.ts`.

| Import                             | What it holds                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `@tiny-agents/agent`               | `AgentRuntime`, the conversation and chat types, the toolkits and capabilities, vault and MCP types, the gateway catalog |
| `@tiny-agents/agent/sandbox`       | `createSandboxConnection` and its types (ADR 0013), host keys, the SSH endpoint                                          |
| `@tiny-agents/agent/terminal`      | `createTerminalService`, its errors, tmux session names                                                                  |
| `@tiny-agents/agent/browser`       | Browser sessions, the Chromium and remote CDP transports (the browser toolkit stays on the root)                         |
| `@tiny-agents/agent/computer`      | Desktop sessions, the X11 transport, desktop settings parsers (the computer toolkit stays on the root)                   |
| `@tiny-agents/agent/claude-worker` | `createSandboxClaudeWorker` and its locator types (ADR 0010), the Claude sign-in shell line                              |
| `@tiny-agents/agent/peer-envelope` | Peer envelope parser; client-safe, imported by the client and the server                                                 |
| `@tiny-agents/agent/testing`       | The faux-provider test runtime                                                                                           |

The root exports only what something outside the package imports. Tests of
the package's internals import the source module directly
(`tests/server/app/agent/*`).

## API surface

| Prefix                                                                        | Purpose                                                | Auth                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------- |
| `/api/v1/auth`                                                                | Login, logout, current user, users                     | Public login · JWT · admin key (users) |
| `/api/v1/passkey`                                                             | Passkey registration, login, management                | Public login · JWT                     |
| `/api/v1/bots`, `/api/v1/events`                                              | tiny-agents: bots, chats (SSE), past chats, browser    | JWT                                    |
| `/api/v1/models`, `/api/v1/capabilities`                                      | tiny-agents: provider accounts, models, model roles    | JWT (mutating routes need step-up)     |
| `/api/v1/tasks`, `/api/v1/routines`, `/api/v1/skills`                         | tiny-agents: tasks, routines, the skills library       | JWT                                    |
| `/api/v1/people`, `/api/v1/memories`                                          | tiny-agents: guests, per-bot memory                    | JWT                                    |
| `/api/v1/connections`, `/api/v1/vault`, `/api/v1/uploads`, `/api/v1/terminal` | tiny-agents: MCP servers, vault, attachments, terminal | JWT                                    |
| `/api/v1/code`                                                                | tiny-agents: the Code page, threads, harnesses         | JWT                                    |
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
