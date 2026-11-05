---
"@tiny-agents/code": minor
"@tiny-agents/agent": minor
"@tiny-agents/claude-worker": minor
"@groot/web": minor
---

Code page harness adapters (issue #157, ADR 0011, ADR 0012): the Code page
drives any coding agent through one adapter contract, starting with Shelley
and Claude Code.

`@tiny-agents/code` (new) holds the contract — `HarnessInstance`,
`TranscriptItem` rows upserted by id, thread and instance events, honest
`Capabilities`, `HarnessHost` — the drivers (`drivers/shelley`: Shelley's
stream2, snapshot list, normalizer and usage report moved off the client;
`drivers/claude-code`: Claude Code on the sandbox through the worker's coding
mode), and a test kit (`capabilityProblems`, an in-memory thread index).

`@groot/web` replaces the Shelley-only server code with a harness-generic
layer: `code_threads` (followed/unread, and the index for harnesses without
their own list) and `code_handoffs` (migration 0006, old Shelley rows copied
at boot), one hub over every instance, a watcher that delivers hand-off
finishes and pushes for any harness, and `/api/v1/code/*` routes
(`/api/v1/shelley/*` is removed). The Code page renders the contract: a
merged list with a harness filter, a harness picker for new threads, and
controls that follow each harness's capabilities (approval and question
cards, permission modes, steer/queue, recovery, Changes, usage).

`@tiny-agents/agent` replaces the `shelley` toolkit with `code`:
`code_start`/`code_send`/`code_status`/`code_list`/`code_models` (Shelley by
default, any harness by name), keeping `shelley_start` and `shelley_send` as
aliases; `ChatToolCall.shelley` becomes `ChatToolCall.code` (older results
still parse).

`@tiny-agents/claude-worker` adds the coding mode: Claude Code's built-in
tools in a plain working directory, `acceptEdits` by default, approvals and
questions through `canUseTool`, steer/queue/interrupt, history, fork and a
fixed set of workspace operations, with its own concurrency budget.
