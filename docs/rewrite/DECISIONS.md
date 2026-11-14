# Rewrite decision log

One entry per decision, newest last. **Proposed** entries are mine and wait
for the owner. On 2026-11-14 the owner accepted D1 to D9 and every
recommendation in the design (Q1 to Q9) and the behavior register
(tracking issue #247). **Accepted** entries are signed off. A decision that ends up
in the code also gets an ADR in `docs/adr/` when it lands.

## D1: Scope excludes the groot kit (accepted, Q1)

`packages/core`, `jobs`, `shell`, `ui`, `.groot/` and the synced scripts and
docs are synced from groot (`.groot/lib/patterns.ts`). Rewriting them forks
the boilerplate and breaks `pnpm groot:sync`. The rewrite consumes them as
they are. The local kit patches that are pending upstream stay on that track.

## D2: Parity first, behavior changes as separate signed-off PRs (accepted)

A rewrite PR changes no observable behavior. It passes:

- the goldens
- the characterization tests
- the existing suites, with unchanged assertions

A behavior change is its own PR. It names a row in
[`behavior-register.md`](./behavior-register.md) that the owner set to Fix,
and updates only that row's goldens. Mixing the two would make every golden
diff ambiguous.

## D3: Proof is in-process golden traces plus deterministic verify journeys (accepted)

Prototype P1 showed that in-process traces are deterministic. They run on:

- the real app
- the real runtime on the faux model
- `FIXED_NOW`
- ids normalized by first appearance

Three runs were byte-identical. The browser-level layer needs a test-only
clock seam (`TINY_AGENTS_FIXED_NOW`, honored only with `TINY_AGENTS_FAUX=1`)
and a fixed name stamp, TZ, locale and no animations.

Rejected: recording real HTTP traffic from a live dev server. It runs on the
real clock, with random ids and timing-dependent streaming, so the diffs
would be noise.

## D4: Keep pi-durable as the only durable store; the Claude plan writes entries into it (accepted, Q2)

Prototype P2: `tx.appendEntry` with `claude.user` and `claude.assistant`
kinds plus a `tx.scanEntries` request-id check in one commit. A retry was
deduplicated, the entries survived a reopen, and pi created no tasks.

This removes `.claude.json` and fixes C1, C2 and C4. It also makes the
engine seam symmetric: both runners admit durably, and one projection reads
both entry families.

It amends ADR 0014's "Claude turns don't survive a restart" only for the
transcript. Owner waits on Claude stay in memory, as today.

Rejected: keeping the JSON file with atomic writes. It still leaves two
transcript stores and two projections.

## D5: Settling reads a TurnSettled edge, not onActivity levels (accepted)

Prototype P3: a plain turn emits exactly one busy and one idle event. The
level/edge difference exists only when wait counts change after the idle
edge (C16), so that flow gets a golden before the switch. If the golden
diffs, the old double-run is reproduced on purpose until C16 is decided.

## D6: Conversations module over existing columns before any table (accepted, Q3)

The six reverse lookups collapse into `Conversations.ownerOf`. A
`conversations` table would need a data migration across `bots`,
`bot_chats` and `routines`, and the API exposes `bot.conversationId` and
`chatStartedAt`. So the module comes first, and the table only if Phase 2
shows the columns resist it.

## D7: Split `@tiny-agents/sandbox` and `@tiny-agents/models` out of `@tiny-agents/agent` (accepted)

Neither touches pi-durable. Together they are about 40% of `packages/agent`
by line count. Package dependencies, plus lint R11, then enforce what is
only a convention today. The toolkits stay in `@tiny-agents/agent`, but they
reach pi-durable only through `ToolCall`.

Rejected: one big package with lint-only layering. It is cheaper, but
importers (the app routes, the Code drivers, the worker locator) would still
pull the pi-durable boundary package to get an SSH connection.

## D8: One composition root (`App`), no server module singletons (accepted)

The boot order becomes declared dependencies rather than call order, and
tests build an `App` with fakes instead of using `setAgentRuntimeForTests`
and manual resets. Lint R12 enforces it with a shrinking allowlist.

## D9: Keep wire protocols and URLs byte-compatible (accepted)

The following do not change:

- the HTTP paths and envelopes
- the SSE event shapes and stream split (Q7)
- the worker WS protocol
- the terminal and VNC WS framing
- the OAuth public URLs
- the faux trigger words

Consumers outside this repo include the sandbox VM, MCP servers, `site/`,
`scripts/demo` and the verify journeys.
