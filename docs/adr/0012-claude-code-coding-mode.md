# ADR 0012: Claude Code's coding mode on the sandbox worker

- Status: **accepted** (amends [0008](0008-claude-code-engine.md) for the coding mode only)
- Date: 2026-11-05

## Context

ADR 0011 made the Code page a front end for harnesses, and the owner asked
for Claude Code as the second one, next to Shelley (issue #157). The Claude
worker already runs Claude Code on the sandbox through the official Agent
SDK (ADR 0008, ADR 0010), but only for bot chats. There Claude Code's own
tools are empty and every tool call is proxied back through tiny-agents'
approval gate.

A coding agent needs the opposite: Claude Code's own tools (read, edit,
run commands, search) working in a repository, with the owner approving what
Claude Code asks about.

The owner decided (issue #157):

- a plain working directory, no worktrees for now;
- new threads accept edits without asking;
- sessions started in a terminal stay out of the list for now;
- bots keep handing work to Shelley by default.

## Decision

- **A separate coding mode in the same worker.** Coding sessions (`coding.*`
  messages on the worker's socket) run one Agent SDK `query()` per thread,
  with:
  - Claude Code's normal built-in tools and setting sources, so the repo's
    `CLAUDE.md` applies;
  - the `claude_code` system prompt;
  - `cwd` set to the thread's working directory;
  - the thread's permission mode (default **`acceptEdits`**), model and
    effort.

  The bot mode is unchanged: tools empty, everything proxied. This amends
  ADR 0008's "Claude Code's own tools are empty" for the coding mode only.

- **Approvals are Claude Code's own.** `canUseTool` relays each request
  (tool, input, reason) to the Code page as an approval card, and the
  owner's answer goes back as the SDK's permission result. `AskUserQuestion`
  becomes a question card. We never answer a request ourselves; a mode the
  owner picks is Claude Code's own (`default`, `acceptEdits`, `plan`,
  `bypassPermissions`), and YOLO maps to `bypassPermissions`.
- **Turns follow the SDK:**
  - Steer is a message pushed into the live input with `priority: "next"`
    (folded into the running turn between tool calls).
  - Queue is held by the worker and sent after the turn's `result`, so it
    can be listed, sent now or cancelled.
  - Stop is `interrupt()`. A stop that arrives before the turn starts is
    handled too.
- **The transcript stays Claude Code's.** History comes from
  `getSessionMessages` on the sandbox, normalized by the same function as
  live messages. tiny-agents keeps only the `code_threads` row: title, cwd,
  settings, and the Claude session id in `data`.
- **The workspace is a fixed set of operations, not a shell.** The worker
  runs a short list of `execFile` calls with path checks:
  - git diffs (working tree and commits), file lists for `@` completion;
  - directory listing and cwd checks;
  - uploads into `~/.tiny-agents/uploads/`, and reading them back.
- **Its own budget.** Coding sessions have their own process and running-turn
  limits, so a long coding run never blocks a bot chat.
- **One worker, shared.** The app keeps one locator per process, so bot
  chats and the harness reach the same worker through the same tunnel.
- Everything else in ADR 0008 and 0010 stands:
  - no Claude credential in tiny-agents;
  - no `ANTHROPIC_BASE_URL` and no relay;
  - overrides are stripped before the worker starts;
  - the subscription login is checked before every session starts;
  - `CLAUDE_CODE_ENGINE_ENABLED` turns the harness on and off together with
    the bot engine.

## Consequences

- **Built-in tools act on the sandbox.** Claude Code's Bash and edits run as
  the sandbox user, the same user that holds `~/.claude` and the bots'
  files (ADR 0010 already notes this). Accept-edits never covers commands:
  those still ask unless the owner switches the thread to bypass.
- **Settings files apply.** Coding sessions load Claude Code's setting
  sources (`user`, `project`, `local`) so a repo's `CLAUDE.md` and settings
  work. That includes any `env` those files set, which the worker's own
  environment checks do not see. A repo you point a thread at is trusted the
  way Claude Code trusts it in a terminal.
- **Shared directories.** Two threads in one working directory edit the
  same files. The new-thread screen warns when another thread is working
  there.
- **Worker restarts.** A deploy that changes the worker bundle restarts the
  worker on its next start check, which cuts off a running coding turn.
  The session resumes from its history on the next message. Deferring the
  restart while turns run is left for later.
- **Coding turns use the owner's plan quota** alongside bot chats. The
  separate budget keeps concurrency at ordinary individual use.
- **No Anthropic calls in CI.** CI runs the coding mode against a fake SDK.

## Links

- [ADR 0008](0008-claude-code-engine.md), [ADR 0010](0010-claude-worker-runs-on-the-sandbox.md),
  [ADR 0011](0011-code-harness-adapters.md)
- [Code](../features/code.md), [Claude subscription](../claude-subscription.md)
