# tiny-agents — Product Requirements Document

> Status: Phase 1 scope agreed · Last updated: 2026-11-08

## 1. Overview

**tiny-agents** is a minimal, personal take on xAI's _Grok Bot_ ("your team of always-on agents"): a
messenger-style app where every contact in the bot list is an AI bot you chat with.

- **Agent core:** [pi-durable](https://earendil.com/posts/pi-durable/) (`@earendil-works/pi-durable`) — every
  conversation is durable: it survives page refreshes, server crashes and redeploys.
- **Foundation:** a child project of the [groot](https://github.com/AshikNesin/groot) boilerplate (Hono +
  React 19 + Drizzle/SQLite + JWT/passkey auth), kept in sync with it via groot's sync tooling.
- **Inference:** all LLM calls go through **Cloudflare AI Gateway**; provider keys live only in the gateway
  (since changed: models are owner data — provider accounts of several kinds, configured in
  Settings → Models; §7.3 and [ADR 0016](docs/adr/0016-models-are-owner-data.md)).
- **UI:** React + shadcn/ui + shadcn [AI Elements](https://ui.shadcn.com/docs/ai-elements). Visual and layout
  reference: [Talorys](https://rociiu.github.io/talorys/#demo) (calm three-column workspace, light + dark);
  product/feature reference: [OpenMausBot](https://github.com/milind-soni/OpenMausBot) and Grok Bot.

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
- Per-bot computers (cloud desktop / VM), code execution (since shipped: the sandbox toolkit, and a desktop per bot on the sandbox VM, issue #108)
- Group channels, @mentions, bot-to-bot messaging, "chief of staff" orchestration
- Routines / schedules, memory files, skills
- File/image uploads, attachments, avatar image upload/generation
- Voice (TTS, calls), notifications
- Message edit / regenerate, conversation forking, multiple threads per bot, search
- Grok / Gemini models (not in pi-ai's gateway catalog yet)
- Sharing / public bots (since shipped: sharing a bot's chat with a guest, issue #145), external channels (Telegram, Discord, …), analytics
- Multi-user data ownership, roles, tenancy
- Cloudflare Workers / Durable Objects hosting, Postgres for the agent store, horizontal scaling

## 4. Users & access

- **Single owner.** Personal app; one human user.
- **Auth = groot's auth, unchanged in behaviour:** email + password (bcrypt) and passkeys (WebAuthn), JWT in an
  HttpOnly `token` cookie (expiry from `config.yml` `auth.jwtExpiresIn`, default 30d).
- **No signup.** The owner creates their account manually via groot's admin endpoint
  (`POST /api/v1/auth/users` with `X-Admin-Auth-Key: $ADMIN_AUTH_KEY`). No seeding from env.
- Additional users can be created the same way, but **bots and conversations are not user-scoped** — every
  logged-in user sees everything (same as groot's `Todo`). Since shipped: **guests** (issue #145), added in
  Settings → People, see only the bots shared with them (in the same chat as the owner) and Code; see
  `docs/features/shared-bots.md`.
- Every `/api/v1` route (including SSE streams) except groot's public auth/passkey routes and `/health`
  requires a valid JWT.

## 5. Phase 1 features

### 5.1 Bots

| Story              | Behaviour                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create bot         | "New bot" opens a single-page dialog: name, description, system prompt, model. The avatar is a DiceBear "gaze" illustration derived from the name. Model defaults to the `bot_default` model role. |
| Edit bot           | Same dialog from the chat header menu. Prompt/model changes apply to the **next turn onward**; history is kept.                                                                                    |
| Delete bot         | Confirm dialog → bot removed from the app. Its pi-durable conversations remain orphaned in `agent.db` (cleanup is Phase 2).                                                                        |
| Reset conversation | **"New chat"** button in the chat header → confirm dialog → bot gets a fresh, empty conversation. The old one becomes a past chat under **Chat history** (issue #101).                             |

### 5.2 Chat

- **One continuous conversation per bot** (messenger model, not ChatGPT-style threads).
- Streaming markdown replies (AI Elements `Message`, Streamdown rendering).
- **Stop** button aborts the in-flight reply.
- Collapsible **Reasoning** block when the model emits thinking.
- **Copy** message action.
- Replies keep generating server-side when you switch bots or close the tab.
- The bot list shows **"typing…"** for bots currently replying and an **unread badge** for bots with new replies.
- **Compaction:** pi-durable background compaction is on (library defaults). The transcript shows a subtle
  "earlier messages summarized" marker; full history remains scrollable.
- Idempotent sends: every message carries a client-generated `requestId`; retries never duplicate a message.

### 5.3 Models

- Models are owner data (issue #179, ADR 0016): the owner adds provider accounts (Anthropic, OpenAI,
  Gemini, OpenAI-compatible hosts, Cloudflare AI Gateway, the Claude plan) and picks their models in
  **Settings → Models**, with no restart. See `docs/features/models.md`.
- The model picker lists those models, grouped by account; a model that can't run is greyed out with why.
- With no model set up, a banner links to Settings → Models and sending is disabled.
- A bot points at a model row; deleting a model in use asks which model takes over.

## 6. UX & screens

Visual and layout reference: the **grok.com Bots** UI (sidebar + conversation), originally Talorys. Every
authenticated page renders inside one app-wide sidebar shell (`AppShell`).

### 6.1 Visual style (Grok-like)

- Calm, minimal workspace: neutral surfaces, thin borders, generous whitespace, **Inter** (already groot's font),
  no accent colour: a warm monochrome palette (off-white/near-black surfaces, dark user bubble, light-grey bot
  bubble) set by app-level token overrides in `apps/web/src/client/app.css` (no edit to the synced shell CSS).
- **Light and dark themes**, dark by default, toggle in the user menu and Settings, choice persisted. (groot
  ships dark tokens but no toggle → upstream change, §12.)
- Bot avatars are DiceBear "gaze" illustrations (`api.dicebear.com/10.x/gaze/svg?seed=<name>`), deterministic per bot name.

### 6.2 Layout (desktop: sidebar + conversation)

| Region                | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Sidebar (app-wide) | 256px, collapsible to a 64px icon rail (persisted). Brand, **Search** (command palette), app nav (Tasks, Skills, Memory, Routines, Settings, …), then the **Bots** section: a **+** button, a **Pinned** group, a **Recent** group (folded after 8 with "Show more"), rows with avatar, name, unread/replying/approval state and a ⋯ menu (Pin/Unpin, Edit). User menu at the bottom (Settings, theme, Log out).                                                                                                                    |
| 2. Conversation       | **Header:** bot avatar + name (opens the edit dialog), **+** new chat (with confirm), browser toggle, ⋯ menu (Pin/Unpin, New chat, Edit bot, Delete bot). **Transcript** (768px column): user messages as right-aligned dark pills, bot replies as left-aligned light cards (radius 24, max 80%), Reasoning collapsible above the text, copy action on hover. **Composer** (752px, radius 24): textarea on top, round attach button left and send/Stop button right below it ("Message {bot}", Enter to send, Shift+Enter newline). |

Pinning is stored per bot (`pinnedAt`, `POST /api/bots/:id/pin`). The page-level top bar keeps the shell's floating
chrome on mobile only (`pageChrome: "sidebar"` hides the back button and profile button at md+).

### 6.3 Routes & screens

| Route / screen  | Contents                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/login`        | groot's login page: email/password + **"Sign in with passkey"** button.                                                           |
| `/`             | Redirects to `/chats`.                                                                                                            |
| `/chats`        | Desktop: opens the last-opened bot (else the sidebar's top bot). Mobile: the Bots section full-screen. No bots: create-first-bot. |
| `/chats/:botId` | Desktop: sidebar + open chat. Mobile: chat full-screen; the hamburger opens the sidebar drawer.                                   |
| Empty state     | No bots yet → centered card with a short explanation and a primary "Create your first bot" button.                                |
| Bot dialog      | Single-page create/edit dialog (name, description, model, system prompt) — not OpenMausBot's multi-section wizard.                |
| Settings        | groot's Settings page (passkeys via `PasskeyManager`) + theme choice.                                                             |
| Gateway banner  | Thin warning bar above the chat pane when gateway env vars are missing.                                                           |

### 6.4 Mobile

- groot shell's mobile top bar (brand, menu drawer for app nav) stays as-is.
- The sidebar becomes a drawer (hamburger in the chat header); `/chats` with no bot open shows the Bots section full-screen.
- Composer stays pinned above the keyboard (`100dvh` layout).
- A Talorys-style **bottom tab bar** is deferred until there are several sections (Phase 2+).

### 6.5 Page pattern for non-chat pages (Settings now, Memory/Routines later)

Following Talorys: centered content (~`5xl`, groot's `PageLayout`), H1 + one-line description, primary action
button, optional search field, lists grouped under small uppercase section labels with counts, rows as bordered
cards with a muted metadata line ("Added manually · just now").

## 7. Architecture

```
Browser (React 19 + shadcn + AI Elements)
   │  REST (actions)            SSE (/events, /bots/:id/stream)
   ▼
Hono (groot apps/web server)  ── auth (groot JWT/passkeys) ── Drizzle ──► app.db (SQLite)
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
- **Ownership rule:** a generic change to a file synced from groot (`packages/{core,shell,ui,jobs}`,
  root `*.config.*` such as `vite.config.ts`, the config schema, `scripts/`, `docs/`) is made in groot first
  (see §12), then synced. tiny-agents does edit synced files for its own needs: `pnpm groot:sync` keeps
  those edits through a three-way merge and reports a conflict when groot changes the same lines (see
  `docs/guides/sync.md`). The Workers target and groot's AI package are deleted here.
- **tiny-agents-owned code:**
  - `apps/web/src/server/api/bots/**`, SSE routes, `apps/web/src/server/app.ts`
  - `apps/web/src/client/pages/**` (+ app components), `apps/web/src/client/App.tsx` (routes, nav items:
    replace groot's demo `Todos` nav with `Chats`), app-level CSS (accent token overrides)
  - `apps/web/src/server/db/schema.ts` (the app tables, starting with `bots`) and the migrations
    `pnpm db:generate` writes to `apps/web/drizzle/`
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
  2. `Harness.open(openNodeSqliteStorage(AGENT_DB_PATH), { models, … })` with one pi-ai provider per
     provider account (from the database).
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
  denormalised `lastActivityAt` and `lastMessagePreview` in `app.db` on commits, feeding the bot list.

### 7.3 Inference: provider accounts

- Each provider account (a `providers` row) becomes one pi-ai provider whose id is the row id; its kind
  fixes the wire API, the auth header and the engine (`claude-plan` runs on the Claude Code engine).
- Keys are `app` vault items (ADR 0015), resolved per request for the account's host and cached for five
  minutes. `packages/agent` takes a `ModelConfig` snapshot and a credential resolver; it reads no env or
  database for models, and `applyModelConfig` swaps providers while running.
- Features that call models on their own (memory capture, titles, vision, auto-review) read model roles.
- Cloudflare AI Gateway is one kind among others: BYOK keys stay in the gateway, and an OpenAI-compatible
  account can route through it.

### 7.4 Storage

| File                         | Owner                                 | Contents                            |
| ---------------------------- | ------------------------------------- | ----------------------------------- |
| `app.db` (`DATABASE_URL`)    | groot / Drizzle (better-sqlite3)      | users, passkeys, KV, jobs, **bots** |
| `agent.db` (`AGENT_DB_PATH`) | pi-durable (Node SQLite storage, WAL) | conversations, transcripts, tasks   |

Kept as separate files so the two drivers never contend for locks and Drizzle migrations never see foreign
tables. The link between them is `Bot.conversationId`.

### 7.5 Streaming

- **SSE** for server → browser, plain REST POST for actions. groot's `compression()` must skip
  `text/event-stream` (§12).
- `GET /api/v1/events` — app-wide stream for the bot list: per-bot typing state, last-message preview, unread
  changes, bot created/updated/deleted.
- `GET /api/v1/bots/:id/stream` — open-chat stream: **snapshot first, then deltas** (from pi-durable
  `watchEvents()`). On reconnect the client simply receives a fresh snapshot — no replay logic. Slow clients
  get re-snapshotted (pi-durable behaviour).
- Frontend renders the stream with AI Elements patterns directly (no Vercel AI SDK required on the backend).

## 8. Data model (`app.db`, Drizzle)

groot's `users`, `passkeys`, `kv` and job tables are unchanged. The app's tables, starting with `bots`
(name, description, system prompt, model id, the current pi-durable `conversationId`, `lastReadAt`,
`lastActivityAt`, `lastMessagePreview`), are defined in `apps/web/src/server/db/schema.ts`, which is the
source of truth for their columns.

Unread = latest assistant entry newer than `lastReadAt` (server-side, so it is consistent across devices).

## 9. API surface (`/api/v1`, groot `{ success, data }` envelope)

| Method & path                           | Purpose                                                        |
| --------------------------------------- | -------------------------------------------------------------- |
| groot `auth/*`, `passkey/*`             | Login, logout, `me`, passkeys, admin user creation (unchanged) |
| `GET /models`                           | Chat models, `defaultModelId`, `canAnswer`, accounts           |
| `/models/providers`, `/models/roles`, … | Settings → Models (owner only; see `docs/features/models.md`)  |
| `GET /bots`                             | List bots with bot-list fields (preview, activity, unread)     |
| `POST /bots`                            | Create bot (+ conversation)                                    |
| `GET /bots/:id`                         | Bot detail                                                     |
| `PATCH /bots/:id`                       | Update bot (re-configures conversation)                        |
| `DELETE /bots/:id`                      | Delete bot                                                     |
| `POST /bots/:id/messages`               | `{ requestId, text }` → submit; idempotent on `requestId`      |
| `POST /bots/:id/abort`                  | Stop the in-flight reply                                       |
| `POST /bots/:id/reset`                  | Fresh conversation                                             |
| `POST /bots/:id/read`                   | Mark read (sets `lastReadAt`)                                  |
| `GET /bots/:id/stream`                  | SSE: snapshot + deltas for the open chat                       |
| `GET /events`                           | SSE: app-wide bot-list activity                                |
| `GET /health` (no auth)                 | 200 only after Harness is open and `resume()` done; else 503   |

Request bodies validated with zod (groot `parseBody`).

## 10. Configuration

Env vars are validated with Zod at boot: groot's in `packages/core/src/env.ts`, tiny-agents' own in
`apps/web/src/server/env.ts` (`appEnv()`). No new keys in the synced `config.yml` schema.

| Variable                                                                          | Source                   | Notes                                            |
| --------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------ |
| `DATABASE_URL`, `JWT_SECRET_KEY`, `ADMIN_AUTH_KEY`, `RP_NAME`/`RP_ID`/`ORIGIN`, … | groot                    | unchanged                                        |
| `SECRETS_KEY`                                                                     | tiny-agents (`appEnv()`) | seals vault items, provider keys included        |
| `AGENT_DB_PATH`, `DATA_DIR`                                                       | tiny-agents (`appEnv()`) | `./data/agent.db` (dev), `/data/agent.db` (prod) |

## 11. Deployment

- **Production: Coolify (≥ 4.3.1)** using groot's Railpack setup.
  - Build pack: **Railpack**. Health check: **`/health`**.
  - One persistent volume at **`/data`**: production defaults already point both stores at
    it (`DATABASE_URL=file:/data/app.db`, `AGENT_DB_PATH=/data/agent.db`), so mounting the
    volume is the only step — no env overrides needed for the default SQLite layout.
  - **Container naming → "Consistent name (no rolling updates)"** so Coolify stops the old container before
    starting the new one. Rolling updates would briefly run two processes against the same SQLite files,
    which pi-durable does not support. Accept a few seconds of downtime per deploy; in-flight replies are
    resumed by pi-durable.
  - **Stop Grace Period:** default 30 s (graceful Harness close).
  - Full production env (incl. `SECRETS_KEY`) must be set **before the first deploy**: the server validates
    it at boot and refuses to start without the required secrets.
- **Development:** this exe.dev VM, `pnpm dev` (Vite in middleware mode, single process).

## 12. Prerequisite changes in groot (upstream first, then sync)

These are generic improvements made in the groot repo, then pulled in with `pnpm groot:sync`:

1. **pi-ai upgrade:** groot's AI package → `@earendil-works/pi-ai` `1.3.0` (exact) and use the built-in
   `cloudflare-ai-gateway` provider, replacing the hand-rolled `CF_AI_GATEWAY_BASE_URL` /
   `CF_AI_GATEWAY_AUTH_KEY` setup (and its hardcoded 128k context / reasoning-off defaults). tiny-agents
   has since deleted that package and calls pi-ai from `packages/agent`.
2. **Env schema:** add `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID` and
   `DEFAULT_MODEL` to groot's env schema (`packages/core/src/env.ts`).
3. **SSE-safe compression:** `compression()` filter skips `text/event-stream`.
4. **Auth hardening:** rate-limit `auth/login` and passkey login routes; compare `X-Admin-Auth-Key` with
   `crypto.timingSafeEqual`.
5. **Passkey sign-in button** on `packages/shell` `Login.tsx` (backend/store already support it).
6. **Deploy docs:** note in `docs/guides/deploy.md` that SQLite deployments on Coolify must disable rolling
   updates.
7. **Theme toggle in `packages/shell`:** wire the existing `.dark` tokens — light/dark/system toggle in the
   user menu, persisted in localStorage, applied before first paint (no flash); app-configurable default
   (tiny-agents uses dark). Make shell-owned editors (e.g. `CodeMirrorEditor`) follow the theme.

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

| Risk                                                                                          | Mitigation                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| pi-durable is experimental; API changes without notice                                        | Exact pins; all usage behind `packages/agent`; upgrade deliberately with tests.                  |
| Two processes on one `agent.db` (rolling deploys, accidental second instance)                 | Rolling updates disabled; exclusive lock at boot; `/health` gated on resume.                     |
| groot sync conflicts                                                                          | Never edit synced files; child-only `packages/agent` excluded from sync; upstream generic fixes. |
| A provider's catalog lacks a model                                                            | Add any model by id in Settings → Models, with its capabilities set by hand.                     |
| pnpm `minimumReleaseAge` (24h) / `trustPolicy` blocks very fresh `@earendil-works/*` releases | Pin to versions older than 24h; upgrade deliberately.                                            |
| Orphaned conversations accumulate in `agent.db` on delete/reset                               | Accepted for Phase 1; cleanup in Phase 2.                                                        |

## 15. Roadmap (Phase 2+)

- **Tools** via pi-durable `defineTool` (durable tool calls, replay-safe tools), approvals UI
  (AI Elements `Tool`, `Confirmation`). Tool activity shown inline as compact status chips above the reply
  (Talorys: "✓ Adding task …"). _(shipped: toolkits, the Tool gate and approvals; see
  [ADR 0004](docs/adr/0004-every-bot-has-every-toolkit.md), [ADR 0014](docs/adr/0014-tool-gate-and-engine-seam.md))_
- Message edit / regenerate and conversation **fork**; multiple threads per bot (then a per-bot history list
  with "Search history", as in Talorys' conversation column). _(shipped in the Code page's threads, which
  fork; bot chats still have one thread plus past chats)_
- Custom gateway models (Grok, Gemini via `/compat` or Cloudflare REST API). _(shipped: gateway custom
  providers, issue #216)_
- **Memory** page (Talorys "Memories"): what bots know about you, grouped by category (Preferences, Facts,
  Goals, Habits) with counts, searchable, add/edit/delete, source line ("Added manually" / "From chat").
  _(shipped: issue #22, [docs/features/memory.md](docs/features/memory.md))_
- **Routines** page (Talorys "Automations"): reminders and AI routines on groot jobs — "Upcoming" cards,
  "Active schedules" list with enable toggle + delete + next run, "Recent executions". _(shipped: issue #18)_
- Skills; notifications (bell in the nav header, web push); mobile bottom tab bar once there are several
  sections. _(skills and Pushover notifications shipped; web push and the tab bar have not)_
- Channels / group chats, bot-to-bot, chief-of-staff orchestration. _(bot-to-bot delivery shipped, issue
  #12; group chats and orchestration have not)_
- Per-bot computers, connected apps / MCP (computers shipped as desktops on the sandbox VM, issue #108; macOS and Windows machines remain out of scope). _(MCP connections shipped too)_
- Attachments, avatar upload / generation, voice. _(attachments shipped, issues #17 and #58; avatars and voice have not)_
- Orphaned conversation cleanup
- Cloudflare Durable Objects hosting option

## 16. References

- pi-durable: https://earendil.com/posts/pi-durable/
- pi-durable on Cloudflare: https://earendil.com/posts/pi-durable-on-cloudflare/
- pi monorepo (pi-durable, pi-ai): https://github.com/earendil-works/pi
- groot boilerplate: https://github.com/AshikNesin/groot (local: `~/Code/groot`)
- UI reference (visual/layout): Talorys — https://rociiu.github.io/talorys/#demo ·
  https://github.com/rociiu/talorys
- UI reference (product): https://github.com/milind-soni/OpenMausBot
- Grok Bot (xAI): https://x.ai/news/introducing-grok-bot
- shadcn AI Elements: https://ui.shadcn.com/docs/ai-elements
- Cloudflare AI Gateway BYOK: https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/
- Coolify rolling updates: https://coolify.io/docs/applications/deployments/rolling-updates
