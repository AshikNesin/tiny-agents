# ADR 0011: The Code page talks to coding agents through harness adapters

- Status: **accepted** (generalizes [0009](0009-shelley-is-the-coding-agent.md));
  its bare-id rule is superseded by
  [0052](0052-thread-ids-always-carry-their-instance.md): every thread id
  names its instance, and no id defaults to Shelley
- Date: 2026-11-05

## Context

ADR 0009 made Shelley the coding agent and the Code page a client of its
API. The owner then asked for more than one coding agent behind the same
page, starting with Claude Code (issue #157), and for a pattern any agent
could plug into, like [T3 Code](https://github.com/pingdotgg/t3code) and
[Jean](https://github.com/coollabsio/jean).

Both apps were read at the source. They agree on the shape:

- one adapter contract per agent;
- clients read **capabilities**, never which agent it is;
- adapters normalize native output into rows **upserted by id**;
- an integration ("driver") differs from a configured account or host
  ("instance").

They differ from us in one place: they keep every message in their own
database, because everything they drive is a CLI they launch. Shelley is a
server with its own UI and database, and its conversations also start in
that UI and from bots.

## Decision

- **Harnesses plug in through one contract.** `HarnessInstance` lives in
  `packages/code/src/contracts`. The required methods are list, read,
  watch, start, send, stop, outcome and models; optional methods are gated
  by `capabilities()`.
  - The app (hub, watcher, routes, bot tools, Code page) never branches on
    the harness kind.
  - A capability is honest: it is on exactly when the harness does it. A
    harness without approvals gets no approval card; we never answer one
    for it.
  - `@tiny-agents/code/testing` checks that a capability is on only when
    its method exists.
- **Drivers live in `packages/code`** and reach the app only through
  `HarnessHost` (a logger and the thread index), so they never import
  `apps/`. Adding a harness is one driver folder plus one entry in
  `apps/web/src/server/api/code/code.registry.ts`.
- **The harness owns the transcript; tiny-agents owns the thread.**
  - The transcript stays in the harness: Shelley's database, Claude Code's
    session files on the sandbox. We store no message bodies.
  - `code_threads` is the index. For every harness it holds what the owner
    follows and has read. For harnesses that keep no list of their own
    (Claude Code) it also holds the thread itself: title, cwd, settings and
    driver-private `data`.
  - `code_handoffs` replaces `shelley_handoffs`. The old Shelley rows are
    copied once at boot; the old tables stay until a later release drops
    them.
- **Normalize at the boundary.** Drivers turn native messages into
  `TranscriptItem`s with stable ids. A thread watch starts with a full
  snapshot (the history read after the live feed is open), then sends
  changed rows whole. A reconnect starts from a fresh snapshot.
- **Thread ids are `<instance>:<native>`.** Bare ids from before this ADR
  (old chat cards, pushes, `/code/<id>` links) belong to the `shelley`
  instance.
- **One route set**, `/api/v1/code/*`. Thread routes pick the instance from
  the id; harness routes name it. A missing capability answers 404
  `capability_missing`. The Shelley-only `/api/v1/shelley/*` routes are
  removed; the browser was their only client.
- **Bots hand work to any harness.** They use `code_start`, `code_send`,
  `code_status`, `code_list` and `code_models`. Shelley is the default; a
  bot names another with `harness`. `shelley_start` and `shelley_send`
  stay as aliases so older prompts and approval settings keep working.
- Everything else in ADR 0009 stands: the browser never reaches a harness,
  Shelley stays on the tailnet, and turn ends come from the live stream,
  not from polling.

## Consequences

- A harness's history can only be read while the harness is reachable. An
  outage shows on the thread, as before.
- Switching harness in the middle of a thread would need a portable
  hand-off summary, since we keep no log to replay. That is left for later.
- Shelley's UI now runs on the generic contract. Shelley-only features
  became capabilities: queued-message management, background jobs,
  recovery actions, worktrees and the usage report. A future harness gets
  them by implementing the method.
- Normalizing Shelley's messages moved from the browser to the driver
  (server side).

## Alternatives considered

- **App-owned event log for every harness (T3 Code, Jean).** Rejected for
  now. Shelley would need two-way sync and there would be two sources of
  truth. The contract leaves room for a store later without changing
  drivers.
- **One generic adapter per protocol (ACP) only.** Rejected for these two.
  Shelley speaks its own HTTP API and Claude Code is best driven through
  the Agent SDK. A generic ACP driver is a good third harness.

## Links

- [ADR 0009](0009-shelley-is-the-coding-agent.md), [ADR 0012](0012-claude-code-coding-mode.md)
- [Code](../features/code.md)
- Design: issue #157
