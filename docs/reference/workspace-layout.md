# Workspace layout

tiny-agents is a pnpm workspace. The app is built on the
[groot](https://github.com/AshikNesin/groot) boilerplate (Hono, React 19,
Drizzle on SQLite, JWT and passkey auth, Node only) and runs bots on
[pi-durable](https://earendil.com/posts/pi-durable/).

- `packages/agent`: the only module that touches pi-durable (excluded from
  groot sync; app-shaped API so pi-durable churn stays contained). The
  Claude plan client lives under `src/engines/claude-code/`. The Claude
  worker, which does not use pi-durable, is a subpath
  (`@tiny-agents/agent/claude-worker`; see
  [docs/README.md](../README.md#tiny-agentsagent-entry-points)).
- `packages/models`: provider kinds and templates, discovery, test calls,
  `buildProviders` and the Model catalog, on pi-ai only (it imports neither
  pi-durable nor `packages/agent`, lint R11; excluded from groot sync).
- `packages/sandbox`: the sandbox VM layer: SSH connection, terminal tabs,
  browser and computer sessions and transports, their VM setup scripts and
  the forwarding server (it imports neither pi-durable nor `packages/agent`,
  lint R11; excluded from groot sync). The toolkits that drive it stay in
  `packages/agent`.
- `packages/claude-worker`: loopback daemon that drives Claude Code. It
  does not run inside the tiny-agents process.
- `packages/code`: the Code page's harness adapters: one contract every
  coding agent plugs into (Shelley, Claude Code), with the built-in drivers.
- `packages/git`: reads a repository's changes for the Code page (changed
  files, both sides of a file, a change stamp) for every harness, over an
  exec port.
- `packages/github`: one GitHub client for Code (projects, PR links,
  Auto-fix) over the `gh` CLI on the sandbox or HTTPS from the app server.
- `packages/core`, `packages/jobs`, `packages/shell`, `packages/ui`: the
  groot boilerplate's server core, job queue, app shell and component kit.
- `apps/web`: app code (bots API and SSE under `src/server/api/bots`, chat UI
  under `src/client`); everything else is the groot boilerplate, synced via
  `pnpm groot:sync` and never edited here.
- `mobile`: the Android app (Kotlin and Jetpack Compose), a client of the
  same server. A child of groot-mobile-app with its own tooling, checks and
  sync, run from inside `mobile/`; see
  [features/mobile-app.md](../features/mobile-app.md).
- `app.db` (Drizzle, schema in `apps/web/src/server/db/schema.ts`) and
  `agent.db` (pi-durable) are separate SQLite files; the link is
  `bots.conversationId`.

For how a request flows through these pieces, see
[Architecture](../guides/architecture.md).
