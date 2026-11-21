# 0037 — Owner waits park the tool call

- Status: accepted
- Date: 2026-11-21

## Context

A tool call that waits for the owner (an approval card, `ask_owner`
questions, a `request_credentials` sheet, and `browser_enter_code` when it
asks for the code) used to hold its invocation open: it watched its task
document and kept an in-memory promise until the owner answered or a timer
expired. A restart re-ran the call from the start to rebuild the wait, and
the waiting list (`WaitTracker`) stayed empty until that re-run reached it.

pi-durable 1.6 lets a tool's `execute()` return a park instead of a result,
and wake on a signal or a deadline.

## Decision

`parkForOwner` in `packages/agent/src/waiting.ts` is the one owner wait.
It writes the pending state to the call's task document, records the wait
(its tracker channel and what the push names) in `tiny.wait`, and returns
`{ sleep: { signals: [OwnerAnswered.key(<the document kind>)], until: expiresAt } }`. The code that
records the owner's answer (`recordDecision`, `recordYoloDecision`,
`recordAnswers`, `settleRequest`) delivers `OwnerAnswered` under that kind
in the same commit. Each document kind has its own key, because a key wakes
only one wait and one call can wait twice: an approval card, then a sheet. The woken call runs `execute()` again and reads the settled
document; a deadline wake marks it expired. Nothing waits in memory, and
the expiry needs no timer.

`AgentRuntime.open` rebuilds the waiting lists from the sleeping tool tasks
before it returns, so counts, badges and pushes are right at startup. A
parked call that is stopped runs the tool's `cancel()`, which takes it off
the list.

The gate parks for approval the same way. When the gated tool itself parks,
the gate wraps the tool's checkpoint with a park count, so the woken run
passes the tool its own checkpoint and keys its "effect started" memo by
that count: an unsafe tool cut off after a wake still reports interrupted
instead of running twice.

The Claude Code engine's gate still holds its answer in memory, because
that engine runs tools inside its own process and cannot park. Browser and
computer takeovers also stay in memory: they wait on a live browser or
desktop session, which a restart ends anyway.

## Consequences

Tests that let an approval expire move the pinned clock past the deadline,
because the harness wakes sleeps by its clock.
