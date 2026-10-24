# tiny-agents

A messenger-style app where every contact is an AI bot you chat with — built
on [pi-durable](https://earendil.com/posts/pi-durable/) for durable
conversations (survive refreshes, crashes, redeploys) and the
[groot](https://github.com/AshikNesin/groot) boilerplate (Express 5 + React 19

- Prisma/SQLite + JWT/passkey auth). All inference goes through Cloudflare AI
  Gateway (provider keys live only in the gateway).

See `PRD.md` for the full spec. Phase 1: create bots, chat with streamed
replies, durability as a first-class property.

## Development

```sh
pnpm install
pnpm dev          # http://localhost:3000 (demo@example.com / demo@example.com)
```

Set `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`
(and optionally `DEFAULT_MODEL`) for real inference. Without them the app
runs but shows a banner and disables sending. For UI/flow work without the
gateway: `TINY_AGENTS_FAUX=1 pnpm dev` uses a scripted echo model (send
`/ask` to see a bot's questions for you).

## Layout

- `packages/agent` — the only module that touches pi-durable (excluded from
  groot sync; app-shaped API so pi-durable churn stays contained)
- `apps/web` — app code (bots API + SSE under `src/server/api/bots`, chat UI
  under `src/client`); everything else is the groot boilerplate, synced via
  `pnpm groot:sync` and never edited here
- `app.db` (Prisma) and `agent.db` (pi-durable) are separate SQLite files;
  the link is `Bot.conversationId`

## Testing

```sh
pnpm test         # server (incl. agent runtime + SIGKILL durability suite)
pnpm test:client  # client unit tests
pnpm test:e2e     # Playwright (runs on the faux provider)
```

## Deployment

Coolify (Railpack, health check `/health`, one volume at `/app/data`, SQLite
`DATABASE_URL=file:/app/data/app.db`, `AGENT_DB_PATH=/app/data/agent.db`).
**Disable rolling updates** (consistent container naming) — pi-durable allows
only one process per agent store. In-flight replies resume after boot.
