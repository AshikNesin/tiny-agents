# tiny-agents

A messenger-style app where every contact is an AI bot you chat with — built
on [pi-durable](https://earendil.com/posts/pi-durable/) for durable
conversations (survive refreshes, crashes, redeploys) and the
[groot](https://github.com/AshikNesin/groot) boilerplate (Hono + React 19 +
Drizzle/SQLite + JWT/passkey auth, Node only). All inference goes through
Cloudflare AI Gateway (provider keys live only in the gateway).

See `PRD.md` for the full spec. Phase 1: create bots, chat with streamed
replies, durability as a first-class property.

## Demo

[![Watch the 50-second Tiny Agents teaser](docs/demo/teaser-poster.jpg)](docs/demo/tiny-agents-teaser.mp4)

**In 50 seconds:** a trip to Japan from Chennai, planned by a bot that
remembers you, browses and uses its own computer, and pays only after you
approve (card filled from the Vault). You set each tool to Allow, Ask or Off,
open a real shell on the sandbox, connect your tools over MCP, get alerts when
a bot needs you, watch bots hand work to each other, and see a reply survive a
server restart. See [`scripts/demo/teaser/`](scripts/demo/teaser/README.md) to
re-render it. A one-page marketing site lives in [`site/`](site/README.md).

[![Watch the tiny-agents demo (1:39)](docs/demo/poster.jpg)](docs/demo/tiny-agents-demo.mp4)

A 1:39 tour: bots that ask before they act, a live browser (Google Flights,
Chennai → Bangalore), a real terminal on the sandbox VM, routines, and
conversations that survive a refresh. Recorded from the real app with scripted
chat replies; see [`scripts/demo/`](scripts/demo/README.md) to re-record it.

## Development

```sh
pnpm install
pnpm dev          # http://localhost:3000 (demo@example.com / demo@example.com)
```

No `.env` is needed for development; `.env.example` lists every variable.

Set `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`
(and optionally `DEFAULT_MODEL`) for real inference. Without them the app
runs but shows a banner and disables sending. For UI/flow work without the
gateway: `TINY_AGENTS_FAUX=1 pnpm dev` uses a scripted echo model (send
`/ask` to see a bot's questions for you).

Web search and page reading use
[TinyFish](https://www.tinyfish.ai/blog/search-and-fetch-are-now-free-for-every-agent-everywhere)
(`TINYFISH_API_KEY`, from [agent.tinyfish.ai](https://agent.tinyfish.ai)).
Search and Fetch are free; without the key those tools stay hidden.

## Layout

- `packages/agent` — the only module that touches pi-durable (excluded from
  groot sync; app-shaped API so pi-durable churn stays contained)
- `apps/web` — app code (bots API + SSE under `src/server/api/bots`, chat UI
  under `src/client`); everything else is the groot boilerplate, synced via
  `pnpm groot:sync` and never edited here
- `app.db` (Drizzle, schema in `apps/web/src/server/db/schema.ts`) and
  `agent.db` (pi-durable) are separate SQLite files; the link is
  `bots.conversationId`

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

Migrations apply on boot. Uploads live next to the database
(`/app/data/uploads`) unless `UPLOADS_DIR` is set. Production requires
`JWT_SECRET_KEY` (≥ 32 chars), `ADMIN_AUTH_KEY`, `ORIGIN` and `RP_ID`; the
server refuses the development defaults.

**Upgrading from the Prisma build:** the first boot finds the old database,
renames it to `app.db.prisma-backup-<time>` and copies every row into the new
layout (bots, chats, vault items, routines, memories, users, passkeys,
settings). Routines re-arm their next run. Passwords keep working: the first
sign-in replaces the old bcrypt hash. Keep the backup until you have checked
the app, then delete it.
