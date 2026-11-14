# Rewrite plan

This is the PR-by-PR plan for the design in [`README.md`](./README.md),
approved on 2026-11-14 (tracking issue #247). Each PR has a **Proof**: the
check that shows it did what it says and nothing else.

Every PR must pass these, on top of its own proof:

- `pnpm verify`, which runs the static gates, the server tests and the client
  tests.
- From PR 0.2 on, `pnpm golden:check`.

A PR marked ⚑ changes behavior. It names its row in
[`behavior-register.md`](./behavior-register.md) and updates only that row's
goldens. A PR without ⚑ changes no golden and no test assertion.

Status: `todo`, `wip`, `done`, with the commit or PR id.

## Phase S: security fixes on today's code (register S1–S5, Q5)

These land before the baseline, so the goldens record the fixed behavior.

| PR   | Change                                                                                                                                                                                                               | Proof                                                                                                                                                                                            | Status       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| S1 ⚑ | A guest-started turn on a shared bot cannot run `update_instructions`. Self-improve refuses on shared bots, matching bot-builder                                                                                     | A route test: on a shared bot, the guest's turn gets `update_instructions` refused; the owner's own bot is unchanged                                                                             | done c420c46 |
| S2 ⚑ | Guests may watch a shared bot's live view but never drive it: no take control, start, reset, resize or profile delete. Only the owner counts as watching for pushes                                                  | A guest-access route test per verb (403); a `bots.viewers` test showing a guest viewer doesn't suppress the owner's run push                                                                     | done 65c0c56 |
| S3 ⚑ | Guests on the Code API: no `bypassPermissions` mode, and no directory browse, cwd validation, file finding, worktree creation or uploads. Assets are limited to a thread the guest can read                          | Guest-access route tests for each refused route; a settings test refusing `bypassPermissions` for a guest                                                                                        | done 23dfd50 |
| S4 ⚑ | Connections: changing the URL or secret, creating or deleting needs vault step-up. A URL change to another host drops the stored header secret unless a new one is sent. A `secretRef` must name a bot-audience item | Route tests without step-up (403) and with step-up (200); a test that a host change clears the secret; a `secretRef` audience test; client tests for the step-up prompt on the Connections pages | done 543518c |
| S5 ⚑ | `alwaysAllow` takes the tool from the waiting call, not the request body. It is refused for vault-gated calls and ignored with `denied` (as today)                                                                   | A route test where a mismatched body tool cannot widen permissions; a vault-call test                                                                                                            | done 074fcf5 |

## Phase 0: proof harness (no production behavior change)

| PR  | Change                                                                                                                                                                                                                                                                                                                                                    | Proof                                                                                                                                      | Status                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 | `tests/golden/` recorder: the in-process app on the faux runtime, `FIXED_NOW`, a normalizer (ids by first appearance, Dates, request ids), trace format (HTTP, SSE frames, `app.db` tables, `agent.db` transcripts and docs). Adds `pnpm golden:check` and `pnpm golden:update`, the gate in `scripts/gates.mjs`, and coverage in `check-checks-coverage` | The recorder's own tests: the same flow run twice gives identical traces; a deliberate one-line change in a response is reported as a diff | done 03a5f5d                                                                                                                                                                                       |
| 0.2 | Golden flows: bots, chat (send, steer, queue, withdraw, abort, approvals, questions, YOLO, stream, paging), past chats, deliveries (bot-to-bot, mentions)                                                                                                                                                                                                 | `pnpm golden:check` green on a re-run; each flow asserts it reached its end state                                                          | done (see commit log)                                                                                                                                                                              |
| 0.3 | Golden flows: routines (arm, fire, missed, blocked, run now, pause and resume), tasks, memory, skills, people and guests, notifications (fake notifier)                                                                                                                                                                                                   | as 0.2                                                                                                                                     | done (notifications: in 0.4)                                                                                                                                                                       |
| 0.4 | Golden flows: models, vault (with step-up), connections (in-memory MCP), uploads, code (fake harness), terminal (fake tmux), live views (fake transport)                                                                                                                                                                                                  | as 0.2                                                                                                                                     | wip: models, vault, uploads, notifications, code done; connections, terminal, live views rely on their route suites until recorded                                                                 |
| 0.5 | Characterization tests for every **Preserve** row. A row its test cannot reproduce is marked _not real_ in the register                                                                                                                                                                                                                                   | One test per row, named after the row id                                                                                                   | done: every Preserve row pinned (tests/server/characterization, tests/client/characterization); none was not real; U4 by the chat-turn golden; C19 Claude Code runtimes are private and not pinned |
| 0.6 | Deterministic verify journeys: `TINY_AGENTS_FIXED_NOW` (honored only with `TINY_AGENTS_FAUX=1`), a fixed name stamp, TZ and locale pinned, no animations. Fixes `full-pass.sh` and adds `--no-infra`. ARIA snapshots become goldens                                                                                                                       | `full-pass.sh --no-infra` twice with identical ARIA output                                                                                 | done: 31 journeys, ARIA goldens match on three frozen runs except 24 snapshots listed in goldens/volatile.txt                                                                                      |

## Phase 1: composition root (D8)

| PR  | Change                                                                                                                                                                                                           | Proof                                                  | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------ |
| 1.1 | The `App` type and `createApp(deps)` in `apps/web/src/server/app-root.ts`. `entry.node.ts` and the test fixtures build it. The runtime singleton becomes `app.runtime`, and `setAgentRuntimeForTests` is retired | goldens and suites unchanged                           | todo   |
| 1.2 | Live sessions, sandbox, claude worker, terminal, event bus, viewers, ticket stores and SSE set become `App` members                                                                                              | goldens unchanged; R12 lint with a shrinking allowlist | todo   |
| 1.3 | Boot order as declared dependencies: `lifecycle.ts` takes `needs:`; routine rearm comes off the settled sweep and becomes its own part                                                                           | A lifecycle unit test of the order; goldens unchanged  | todo   |
| 1.4 | Turn budget, messaging stores and chat titler move into `App`. The allowlist is empty                                                                                                                            | R12 with an empty allowlist                            | todo   |

## Phase 2: runtime core (D4, D5, D6)

| PR    | Change                                                                                                                                                                                                    | Proof                                                                                                                   | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| 2.1   | `Conversations` module: `ownerOf`, `current`, `moveBot`, `claimForRoutine`. All six reverse lookups go through it                                                                                         | goldens unchanged; a conformance test against the old lookups on seeded data                                            | todo   |
| 2.2   | One chat projection (`projectChat`) and one `userMessages`, `lastMessage` and Finished-reply path, with pi as the only reader                                                                             | goldens and engine-contract tests unchanged                                                                             | todo   |
| 2.3   | `TurnSettled` edge event; the settle pipeline consumes it. C16's old re-run is kept by an explicit step if its golden demands it                                                                          | goldens (including the abort-during-wait flow) unchanged                                                                | todo   |
| 2.4 ⚑ | Claude plan on durable entries (Q2): `claude.user`/`claude.assistant`, request-id dedupe, queue/steer, a one-time `.claude.json` import, `submit` returning on admit. Fixes C1, C2, C4 and C23; checks C3 | Engine-contract suite on both engines including retry/queue/restart cases; an import test from a fixture `.claude.json` | todo   |
| 2.5   | `TurnRunner` seam; `PiEngine` extras move into the runtime store; Claude-only calls move to `ClaudePlan`                                                                                                  | engine-contract and goldens unchanged                                                                                   | todo   |

## Phase 3: tools and infrastructure (D7)

| PR  | Change                                                                                                                                               | Proof                                                             | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| 3.1 | `tool()` / `defineToolkit()` producing `Capability` + extension; gate plan as a field (no WeakMap); typed memos. Two toolkits migrate as the pattern | Capability snapshot of every toolkit unchanged; goldens unchanged | todo   |
| 3.2 | The remaining toolkits migrate; the old `ToolInfo` lists are deleted                                                                                 | same                                                              | todo   |
| 3.3 | `@tiny-agents/models` package from `providers/*` and `model-catalog.ts`                                                                              | goldens unchanged; R11                                            | todo   |
| 3.4 | `@tiny-agents/sandbox` package: ssh, terminal, transports, VM setup, forwarding server                                                               | goldens unchanged; R11                                            | todo   |
| 3.5 | `LiveSessions<S>` replaces both session managers (drift kept via options)                                                                            | the browser and computer session suites unchanged                 | todo   |
| 3.6 | `VmStack` and one shell-quote/exit-code module                                                                                                       | the VM setup suites unchanged                                     | todo   |

## Phase 4: server domain re-cut

| PR    | Change                                                                                           | Proof                                                                                       | Status |
| ----- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------ |
| 4.1   | `bots.service.ts` splits into `bots` (CRUD, links) and `chat` (send, approvals, YOLO, questions) | goldens unchanged                                                                           | todo   |
| 4.2   | `access` module: `Viewer`, per-action checks in services, `GUEST_ACCESS` kept                    | the guest-access tests and goldens unchanged                                                | todo   |
| 4.3   | Browser and computer routes: one profile-addressed router plus per-bot aliases                   | goldens unchanged                                                                           | todo   |
| 4.4 ⚑ | Vault values table + connection secrets as vault items (Q4: C11, S11)                            | A migration test from seeded KV; vault and connection suites; goldens for the migrated rows | todo   |
| 4.5 ⚑ | S6, S7, S8                                                                                       | One test per row                                                                            | todo   |
| 4.6 ⚑ | C7 (at-least-once hand-off delivery), C12, C13                                                   | One test per row                                                                            | todo   |

## Phase 5: client

| PR  | Change                                                                                              | Proof                                 | Status |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| 5.1 | `apps/web/src/shared/api/*` wire types; server handlers and client import them; hand copies deleted | typecheck; client suites unchanged    | todo   |
| 5.2 | React Query resources for Tasks, Routines, Skills and Memory                                        | client suites; ARIA goldens unchanged | todo   |
| 5.3 | React Query for Connections, Vault and Models                                                       | same                                  | todo   |
| 5.4 | Past chats as a read-only chat-session mode                                                         | same                                  | todo   |
| 5.5 | Browser/Computer shared live-view page and panel                                                    | same                                  | todo   |
| 5.6 | Splits of `ChatPane`, `ChatMessageView`, `BotDialog`, `Routines`, `ModelsSettings`                  | same                                  | todo   |

## Phase 6: retire

| PR  | Change                                                                              | Proof                              | Status |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| 6.1 | `pnpm check:old-modules` with the retired-paths list; remaining old modules deleted | the definition of done (design §7) | todo   |
