# ADR 0009: Coding goes to Shelley; tiny-agents is a client of its API

- Status: **accepted**
- Date: 2026-11-03

## Context

The owner codes with [Shelley](https://github.com/boldsoftware/shelley), an
open-source coding agent running on another machine (reached over
Tailscale). Bots handed it work by calling its API and polling for the
result, and everything Shelley did (tool calls, subagents, diffs) was only
visible in Shelley's own UI. Issue #143 asked for a first-class coding
experience inside tiny-agents without building a coding agent.

Shelley ships no authentication ("bring your own"), so its UI cannot be
embedded behind tiny-agents' login, and on exe.dev its end-of-turn webhooks
only accept `*.int.exe.xyz` URLs, so it cannot call tiny-agents back over
Tailscale.

## Decision

- Shelley is the coding agent. tiny-agents runs no coding loop and stores no
  transcripts: Shelley's database is the source of truth and every view is
  read live from its **official** HTTP/SSE API (its `API.md`).
- The browser never talks to Shelley. The server holds **one** `/api/stream2`
  connection (`ShelleyHub`) and forwards a **curated allowlist** of Shelley
  routes under the app's login. Shelley admin (profiles, models, MCP,
  integrations), terminals and file writes are not proxied; they stay in
  Shelley's UI ("Open in Shelley").
- The conversation list is re-read from `/api/conversations/snapshot` when
  Shelley publishes a list patch (debounced), not patched in place.
- Turn ends come from the stream (`conversation_state.working` true → false,
  with `agent_done`'s `final_response`), never from polling or webhooks.
  Bot hand-offs (`shelley_start`) return at once; the finish is delivered
  into the bot's chat once (compare-and-set on `shelley_handoffs`), and
  missed finishes are reconciled on every reconnect.
- tiny-agents keeps only what Shelley cannot: hand-offs and what the owner
  has seen (`shelley_seen`).
- One setting, `SHELLEY_URL`. Requests always carry `X-Exedev-Userid`
  (exe.dev's `-require-header`); "Open in Shelley" links to the same URL.
- An exception to ADR 0004's "effectful tools ask": `shelley_start` and
  `shelley_send` default to Allow (`ToolInfo.allowByDefault`). Handing coding
  work to Shelley is what the owner asked the bot for; an approval card per
  hand-off only delays it. Shelley's own rules (and the bot's prompt) govern
  pushes and destructive actions; the owner can set either tool to Ask.

## Consequences

- New Shelley features need one allowlisted route and a renderer, not an
  agent change.
- A Shelley outage shows on the Code page and makes bot tools fail clearly;
  nothing else in tiny-agents depends on it.
- The diff viewer renders with jsdiff for now; the agreed renderer is
  @pierre/diffs, pending a supply-chain exception for `@pierre/theme@2.0.0`
  (published without provenance after an earlier release had it).
