# ADR 0004: Every bot has every built-in toolkit

- Status: **accepted**
- Date: 2026-10-23

## Context

Issue #1 (D2) made every capability off by default: each bot listed the
toolkits it could use (the `toolkits` column), and the bot dialog showed a
switch per toolkit, with per-tool Allow / Ask / Off underneath. In practice
a new bot started unable to do anything (not even add a task) until the
owner switched toolkits on, every time. Some switches did nothing at all:
memory was always on (its real switch is on the Memory page) and vision was
chosen automatically by model.

Per-tool permissions already cover what the switch did: `off` removes a
tool from the model, and every effectful tool asks the owner before it runs
by default. The toolkit switch was a second, redundant layer.

## Decision

- Every bot gets every built-in toolkit (`BOT_TOOLKITS` in
  `bots.conversation.ts`); the `toolkits` column is dropped. A bot is shaped only
  by tool permissions. MCP connections stay a per-bot choice.
- Automatic capabilities (`auto: true`: vision, tool search, today's date)
  are not shown in the bot's settings.
- The `time` toolkit is replaced by a prompt line with today's date in the
  owner's timezone (`today` capability), at day resolution so the prompt
  cache survives. Relative reminders use a `{ kind: "in", minutes }`
  schedule the routines tool resolves itself.
- A toolkit that is not configured (web without its API key) offers the
  model no tools, so enabling it everywhere costs nothing.

## Consequences

- All built-in tools together add about 3k tokens per request, cached by
  the provider; acceptable against the setup friction it removes.
- Amended 2026-11-18 (issue #360): the built-ins had grown to about 11k
  tokens. The toolkits few conversations use (browser, computer, code,
  attachments, bot builder, self-improve, vault: about 7k of them) are now
  deferred: every bot still has them, but the model loads them with
  `tool_search` when it needs them, and a stable prompt section names them.
  Tasks, routines, web, sandbox, memory, skills, bots and questions stay
  direct.
- Existing bots gain the toolkits they had off. Effectful tools still ask
  first; a tool the owner does not want for a bot is set to Off.
- Bots know the date but not the exact clock time. A bot asked for the time
  can only answer to the day.

## Alternatives considered

- **A default set for new bots, switches kept.** Leaner context, but still
  a toggle for the power tools and two layers of control.
- **Defaults chosen in Settings.** Flexible, but adds a setting to explain.
- **Time to the minute in the prompt.** Changes the prompt every minute,
  which would defeat prompt caching for the whole conversation.
