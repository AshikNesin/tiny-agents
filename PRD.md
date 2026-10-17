# tiny-agents — Product Requirements Document

> Status: Phase 1 scope agreed · Last updated: 2026-10-17

## 1. Overview

**tiny-agents** is a minimal, personal take on xAI's _Grok Bot_ ("your team of always-on agents"): a
messenger-style app where every contact in the sidebar is an AI bot you chat with.

- **Agent core:** [pi-durable](https://earendil.com/posts/pi-durable/) (`@earendil-works/pi-durable`) — every
  conversation is durable: it survives page refreshes, server crashes and redeploys.
- **Foundation:** a child project of the [groot](https://github.com/AshikNesin/groot) boilerplate (Express 5 +
  React 19 + Prisma/SQLite + JWT/passkey auth), kept in sync with it via groot's sync tooling.
- **Inference:** all LLM calls go through **Cloudflare AI Gateway**; provider keys live only in the gateway.
- **UI:** React + shadcn/ui + shadcn [AI Elements](https://ui.shadcn.com/docs/ai-elements), with a dark,
  Grok-inspired look (UX reference: [OpenMausBot](https://github.com/milind-soni/OpenMausBot)).

Phase 1 delivers the core only: **create bots and chat with them**. Tools and everything else come later.

## 2. Goals & success criteria

### Goals (Phase 1)

1. Create, edit and delete bots (persona + model).
2. Chat with a bot with streamed replies and persisted history.
3. Durability as a first-class property — conversations never get lost or duplicated.
4. A clean foundation (groot + pi-durable) that later phases can extend with tools, channels, routines, etc.

### Definition of done

Phase 1 is done when, on the Coolify deployment:

- [ ] I can log in (password or passkey), create a bot, open it and chat with streamed replies.
- [ ] **Refreshing the page mid-reply** reconnects and shows the reply continuing (or completed) — no loss.
- [ ] **Restarting / redeploying the server mid-reply** resumes the reply after boot, or marks it cleanly as
      interrupted — no lost user messages, no duplicated messages.
- [ ] A bot that is replying while I'm viewing another bot shows "typing…" and then an unread badge.
- [ ] All tests in §13 pass in CI.

## 3. Non-goals (Phase 1)

Explicitly out of scope (see §15 Roadmap):

- Tools / function calling, MCP, connected apps (Composio)
- Per-bot computers (cloud desktop / VM), code execution
- Group channels, @mentions, bot-to-bot messaging, "chief of staff" orchestration
- Routines / schedules, memory files, skills
- File/image uploads, attachments, avatar image upload/generation
- Voice (TTS, calls), notifications
- Message edit / regenerate, conversation forking, multiple threads per bot, search
- Grok / Gemini models (not in pi-ai's gateway catalog yet)
- Sharing / public bots, external channels (Telegram, Discord, …), analytics
- Multi-user data ownership, roles, tenancy
- Cloudflare Workers / Durable Objects hosting, Postgres for the agent store, horizontal scaling

## 4. Users & access

- **Single owner.** Personal app; one human user.
- **Auth = groot's auth, unchanged in behaviour:** email + password (bcrypt) and passkeys (WebAuthn), JWT in an
  HttpOnly `token` cookie (expiry from `config.yml` `auth.jwtExpiresIn`, default 30d).
- **No signup.** The owner creates their account manually via groot's admin endpoint
  (`POST /api/v1/auth/users` with `X-Admin-Auth-Key: $ADMIN_AUTH_KEY`). No seeding from env.
- Additional users can be created the same way, but **bots and conversations are not user-scoped** — every
  logged-in user sees everything (same as groot's `Todo`).
- Every `/api/v1` route (including SSE streams) except groot's public auth/passkey routes and `/health`
  requires a valid JWT.

## 5. Phase 1 features

### 5.1 Bots

| Story | Behaviour |
| --- | --- |
| Create bot | "New bot" opens a single-page dialog: name, description, system prompt, model, avatar (emoji/initials + colour). Model defaults to `DEFAULT_MODEL`. |
| Edit bot | Same dialog from the chat header menu. Prompt/model changes apply to the **next turn onward**; history is kept. |
| Delete bot | Confirm dialog → bot removed from the app. Its pi-durable conversations remain orphaned in `agent.db` (cleanup is Phase 2). |
| Reset conversation | Confirm dialog → bot gets a fresh, empty conversation. The old one is kept in `agent.db` but hidden. |

### 5.2 Chat

- **One continuous conversation per bot** (messenger model, not ChatGPT-style threads).
- Streaming markdown replies (AI Elements `Message`, Streamdown rendering).
- **Stop** button aborts the in-flight reply.
- Collapsible **Reasoning** block when the model emits thinking.
- **Copy** message action.
- Replies keep generating server-side when you switch bots or close the tab.
- Sidebar shows **"typing…"** for bots currently replying and an **unread badge** for bots with new replies.
- **Compaction:** pi-durable background compaction is on (library defaults). The transcript shows a subtle
  "earlier messages summarized" marker; full history remains scrollable.
- Idempotent sends: every message carries a client-generated `requestId`; retries never duplicate a message.

### 5.3 Models

- Model picker lists the static catalog of pi-ai's built-in **`cloudflare-ai-gateway`** provider (Claude,
  OpenAI, Workers AI models).
- If the gateway env vars are missing, a global banner is shown and sending is disabled.
- If a bot's saved model is no longer in the catalog (e.g. after a pi-ai upgrade), its chat shows a warning
  and sending is disabled until a new model is picked.

## 6. UX & screens

Dark, Grok-inspired theme by default, with a light/dark toggle. Pages render inside groot's `shell` layout.

| Screen | Contents |
| --- | --- |
| Login | groot's login page: email/password + **"Sign in with passkey"** button. |
| Main (desktop) | **Left sidebar:** bot list (avatar, name, last-message preview, typing/unread state) sorted by most recent activity, "New bot" button. **Right pane:** chat with header (avatar, name, model) + menu (Edit, Reset conversation, Delete), transcript, prompt input with Stop. |
| Main (mobile) | Sidebar collapses into a drawer; chat is full-screen. |
| Empty state | No bots yet → prompt to create the first bot. No bot selected → hint to pick one. |
| Bot dialog | Single-page create/edit form (not OpenMausBot's multi-section wizard). |
| Settings | groot's existing Settings page (passkey management via `PasskeyManager`). |

## 7. Architecture

```
Browser (React 19 + shadcn + AI Elements)
   │  REST (actions)            SSE (/events, /bots/:id/stream)
   ▼
Express 5 (groot apps/web server)  ── auth (groot JWT/passkeys) ── Prisma ──► app.db (SQLite)
   │
   ▼
packages/agent  (only module that touches pi-durable)
   │  Harness (single instance)                               ──► agent.db (SQLite, pi-durable-owned)
   ▼
@earendil-works/pi-ai  cloudflare-ai-gateway provider  ──► Cloudflare AI Gateway ──► Anthropic / OpenAI / Workers AI
```

### 7.1 Foundation: groot child project

- **Bootstrap:** copy groot's working tree from `~/Code/groot` HEAD into this repo as a single commit (no groot
  git history), keeping this repo's `PRD.md`/`README.md`. Run `pnpm groot:setup` (app name `tiny-agents`). Set
  `.groot/boilerplate-sync.json` `last_sync` to the copied groot commit/version, and add `"packages/agent/**"`
  to `additional_exclusions`.
- **Syncing:** `pnpm groot:check` / `pnpm groot:sync` / `pnpm groot:resolve` pull groot updates;
  `pnpm groot:upstream` pushes fixes back to groot. groot's sync CI workflow stays enabled.
- **Ownership rule:** files synced from groot are **never edited in tiny-agents** — this includes
  `packages/{core,shell,ui,jobs,ai}`, `.env.schema`, root `*.config.*` (e.g. `prisma.config.ts`), the config
  schema, `scripts/`, `docs/`. Any change there is made in groot first (see §12), then synced.
  Exception: a clearly marked tiny-agents block at the end of `.env.schema` (§10).
- **tiny-agents-owned code:**
  - `apps/web/src/server/api/bots/**`, SSE routes, `apps/web/src/server/routes.ts`
  - `apps/web/src/client/pages/**` (+ app components)
  - `apps/web/prisma/**` — `Bot` model added to **both** `schema.sqlite.prisma` and `schema.postgres.prisma`
    with migrations (groot convention)
  - `packages/agent/**` — new workspace package, child-only
  - `config.yml`, `README.md`, `tests/server/{app,routes}/**`, `tests/e2e/**`

### 7.2 Agent core: `packages/agent` (pi-durable)

- The **only** module importing `@earendil-works/pi-durable` (and the Chord context). Exposes a small,
  app-shaped API (e.g. `createBotConversation`, `configure`, `submit`, `abort`, `reset`, `watch`,
  `activity`) so pi-durable API churn is contained here.
- **Exact version pins** for all `@earendil-works/*` packages (pi-durable is explicitly "experimental, API
  changes without notice"). One pi-ai version across the workspace.
- **Lifecycle:**
  1. On server boot: acquire an **exclusive lock** on `agent.db` (retry briefly; if still held by another
     process, exit non-zero — never run two owners).
  2. `Harness.open(openNodeSqliteStorage(AGENT_DB_PATH), { models, … })` with the gateway provider registered.
  3. `harness.resume()` to continue interrupted work.
  4. Only then report healthy (`/health` returns 503 until resume completes).
  5. Close the Harness in groot's graceful shutdown (close-with-grace).
- **Single process only.** pi-durable has no cross-process locking; groot on SQLite is single-replica too.
- **Bot ↔ conversation mapping:**
  - Create bot → `createConversation()`; store `conversationId` on the bot; `configure()` system prompt + model.
  - Edit bot → `configure()` the existing conversation (applies from the next turn).
  - Reset → create a new conversation, swap `conversationId`; old conversation kept, hidden.
  - Delete → bot row removed; conversation left orphaned in `agent.db`.
  - Send → `submit()` with the client `requestId` (pi-durable dedupes by `requestId`).
  - Stop → `abort()`.
- **Compaction:** enabled with library defaults.
- **Activity feed:** the module maintains per-bot activity (replying / idle) and updates the bot's
  denormalised `lastActivityAt` and `lastMessagePreview` in `app.db` on commits, feeding the sidebar.

### 7.3 Inference: Cloudflare AI Gateway

- pi-ai v1.3's built-in provider `cloudflare-ai-gateway` (`cloudflareAIGatewayProvider()`), configured by
  `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`. It sends only
  `cf-aig-authorization`; no upstream provider key ever leaves the app.
- No other providers are configured.
- **Manual prerequisite (outside the app):** the owner configures the gateway in Cloudflare —
  Authenticated Gateway on, provider keys (Anthropic, OpenAI) stored in the gateway (BYOK); "Require provider
  credentials" recommended so it never silently falls back to Unified Billing.

### 7.4 Storage

| File | Owner | Contents |
| --- | --- | --- |
| `app.db` (`DATABASE_URL`) | groot / Prisma (better-sqlite3) | users, passkeys, KV, jobs, **bots** |
| `agent.db` (`AGENT_DB_PATH`) | pi-durable (Node SQLite storage, WAL) | conversations, transcripts, tasks |

Kept as separate files so the two drivers never contend for locks and Prisma migrations never see foreign
tables. The link between them is `Bot.conversationId`.

### 7.5 Streaming

- **SSE** for server → browser, plain REST POST for actions. groot's `compression()` must skip
  `text/event-stream` (§12).
- `GET /api/v1/events` — app-wide stream for the sidebar: per-bot typing state, last-message preview, unread
  changes, bot created/updated/deleted.
- `GET /api/v1/bots/:id/stream` — open-chat stream: **snapshot first, then deltas** (from pi-durable
  `watchEvents()`). On reconnect the client simply receives a fresh snapshot — no replay logic. Slow clients
  get re-snapshotted (pi-durable behaviour).
- Frontend renders the stream with AI Elements patterns directly (no Vercel AI SDK required on the backend).

## 8. Data model (`app.db`, Prisma)

groot's existing `User`, `Passkey`, KV and job tables are unchanged. New:

```prisma
model Bot {
  id                 String    @id @default(cuid())
  name               String    // max 100
  description        String    @default("") // one line, max 200
  systemPrompt       String    @default("") // persona, max ~24 KB
  modelId            String    // id from the cloudflare-ai-gateway catalog
  avatarEmoji        String?   // emoji; falls back to initials of name
  avatarColor        String    // hex / palette token
  conversationId     String    @unique // current pi-durable conversation
  lastReadAt         DateTime?
  lastActivityAt     DateTime  @default(now())
  lastMessagePreview String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@map("bots")
}
```

Unread = latest assistant entry newer than `lastReadAt` (server-side, so it is consistent across devices).

## 9. API surface (`/api/v1`, groot `{ success, data }` envelope)

| Method & path | Purpose |
| --- | --- |
| groot `auth/*`, `passkey/*` | Login, logout, `me`, passkeys, admin user creation (unchanged) |
| `GET /models` | Gateway catalog, `DEFAULT_MODEL`, `gatewayConfigured` flag |
| `GET /bots` | List bots with sidebar fields (preview, activity, unread) |
| `POST /bots` | Create bot (+ conversation) |
| `GET /bots/:id` | Bot detail |
| `PATCH /bots/:id` | Update bot (re-configures conversation) |
| `DELETE /bots/:id` | Delete bot |
| `POST /bots/:id/messages` | `{ requestId, text }` → submit; idempotent on `requestId` |
| `POST /bots/:id/abort` | Stop the in-flight reply |
| `POST /bots/:id/reset` | Fresh conversation |
| `POST /bots/:id/read` | Mark read (sets `lastReadAt`) |
| `GET /bots/:id/stream` | SSE: snapshot + deltas for the open chat |
| `GET /events` | SSE: app-wide sidebar activity |
| `GET /health` (no auth) | 200 only after Harness is open and `resume()` done; else 503 |

Request bodies validated with zod (groot `parseBody`).

## 10. Configuration

All env vars are declared in `.env.schema` (varlock). No new keys in the synced `config.yml` schema.

| Variable | Source | Notes |
| --- | --- | --- |
| `DATABASE_URL`, `JWT_SECRET_KEY`, `ADMIN_AUTH_KEY`, `RP_NAME`/`RP_ID`/`ORIGIN`, `STORAGE_DRIVER`, … | groot | unchanged |
| `CLOUDFLARE_API_KEY` (@sensitive), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID` | groot (upstreamed, §12) | gateway auth |
| `DEFAULT_MODEL` | groot (upstreamed, §12) | default model id for new bots |
| `AGENT_DB_PATH` | tiny-agents block at end of `.env.schema` | default `./data/agent.db` |

## 11. Deployment

- **Production: Coolify (≥ 4.3.1)** using groot's Railpack setup.
  - Build pack: **Railpack**. Health check: **`/health`**.
  - One persistent volume at **`/app/data`**: `DATABASE_URL=file:/app/data/app.db`,
    `AGENT_DB_PATH=/app/data/agent.db`.
  - **Container naming → "Consistent name (no rolling updates)"** so Coolify stops the old container before
    starting the new one. Rolling updates would briefly run two processes against the same SQLite files,
    which pi-durable does not support. Accept a few seconds of downtime per deploy; in-flight replies are
    resumed by pi-durable.
  - **Stop Grace Period:** default 30 s (graceful Harness close).
  - Full production env (incl. gateway vars) must be set **before the first deploy** — varlock validates it at
    build time.
- **Development:** this exe.dev VM, `pnpm dev` (Vite in Express middleware mode, single process).

## 12. Prerequisite changes in groot (upstream first, then sync)

These are generic improvements made in the groot repo, then pulled in with `pnpm groot:sync`:

1. **pi-ai upgrade:** `packages/ai` → `@earendil-works/pi-ai` `1.3.0` (exact) and use the built-in
   `cloudflare-ai-gateway` provider, replacing the hand-rolled `CF_AI_GATEWAY_BASE_URL` /
   `CF_AI_GATEWAY_AUTH_KEY` setup (and its hardcoded 128k context / reasoning-off defaults). Update
   `docs/features/ai-inference.md`.
2. **Env schema:** add `CLOUDFLARE_API_KEY` (@sensitive), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`,
   `DEFAULT_MODEL` to `.env.schema`.
3. **SSE-safe compression:** `compression()` filter skips `text/event-stream`.
4. **Auth hardening:** rate-limit `auth/login` and passkey login routes; compare `X-Admin-Auth-Key` with
   `crypto.timingSafeEqual`.
5. **Passkey sign-in button** on `packages/shell` `Login.tsx` (backend/store already support it).
6. **Deploy docs:** note in `docs/guides/deploy.md` that SQLite deployments on Coolify must disable rolling
   updates.

## 13. Testing

Uses groot's existing Vitest (server: supertest; client: jsdom) and Playwright setup.

- **Unit/integration (Vitest):** bots API (CRUD, validation, auth required), `packages/agent` (create /
  configure / submit / abort / reset, `requestId` idempotency, lock behaviour) using an in-memory storage and a
  fake/mock pi-ai model — **no real API keys in tests**.
- **Durability test (automated):** start server → send a message → kill the server mid-reply → restart →
  assert the reply completes or is marked interrupted, and that there are no duplicate user/assistant
  messages.
- **E2E (Playwright):** login → create bot → chat (streamed reply visible) → refresh mid-reply → reply still
  present.

## 14. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| pi-durable is experimental; API changes without notice | Exact pins; all usage behind `packages/agent`; upgrade deliberately with tests. |
| Two processes on one `agent.db` (rolling deploys, accidental second instance) | Rolling updates disabled; exclusive lock at boot; `/health` gated on resume. |
| groot sync conflicts | Never edit synced files; child-only `packages/agent` excluded from sync; upstream generic fixes. |
| Gateway catalog lacks Grok/Gemini | Accepted for Phase 1; custom models in Phase 2. |
| pnpm `minimumReleaseAge` (24h) / `trustPolicy` blocks very fresh `@earendil-works/*` releases | Pin to versions older than 24h; upgrade deliberately. |
| Orphaned conversations accumulate in `agent.db` on delete/reset | Accepted for Phase 1; cleanup in Phase 2. |

## 15. Roadmap (Phase 2+)

- **Tools** via pi-durable `defineTool` (durable tool calls, replay-safe tools), approvals UI
  (AI Elements `Tool`, `Confirmation`)
- Message edit / regenerate and conversation **fork**; multiple threads per bot
- Custom gateway models (Grok, Gemini via `/compat` or Cloudflare REST API)
- Memory, skills, routines / schedules (groot jobs), notifications
- Channels / group chats, bot-to-bot, chief-of-staff orchestration
- Per-bot computers, connected apps / MCP
- Attachments, avatar upload / generation, voice
- Orphaned conversation cleanup
- Cloudflare Durable Objects hosting option

## 16. References

- pi-durable: https://earendil.com/posts/pi-durable/
- pi-durable on Cloudflare: https://earendil.com/posts/pi-durable-on-cloudflare/
- pi monorepo (pi-durable, pi-ai): https://github.com/earendil-works/pi
- groot boilerplate: https://github.com/AshikNesin/groot (local: `~/Code/groot`)
- UI reference: https://github.com/milind-soni/OpenMausBot
- Grok Bot (xAI): https://x.ai/news/introducing-grok-bot
- shadcn AI Elements: https://ui.shadcn.com/docs/ai-elements
- Cloudflare AI Gateway BYOK: https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/
- Coolify rolling updates: https://coolify.io/docs/applications/deployments/rolling-updates
