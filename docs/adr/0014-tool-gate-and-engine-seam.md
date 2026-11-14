# ADR 0014: One Tool gate for both engines, behind a real AgentEngine seam

- Status: **accepted** (amends [0008](0008-claude-code-engine.md); amended by
  [0016](0016-models-are-owner-data.md): the engine comes from the model's
  provider kind; amended by [0018](0018-claude-plan-transcripts-are-durable-entries.md):
  the Claude plan's transcript is durable entries in the conversation, and its
  `submit` returns on admit. Its turns and owner waits still do not survive a
  restart; rewrite step 2.5 made the seam the runtime's only way into an
  engine, below)
- Date: 2026-11-05

## Context

ADR 0008 added the Claude plan engine beside the pi-durable harness and said
that every Claude tool call comes back "through the approval gate". In code
that was two gates. The pi engine wrapped each capability tool in `gateTool`:
permission, gate plans (vault cards, refusals), the unattended refusal, YOLO
mode, auto-review, the approvals `WaitTracker` and result redaction. The
Claude plan engine had its own `createClaudeApprovalGate`, with permission and
YOLO only. The YOLO rule "is this the owner's turn" was written twice, once
over pi entries and once over chat messages, and issue #151 had to change both
gates and add two parallel test files.

The drift was already visible. A Claude plan call waiting for the owner was
not counted by `pendingApprovals`, the activity `approvals` count or `onWait`,
so the Bot list badge and push notifications missed it. Its result skipped the
secret redactor. Auto-review and gate plans never applied.

The engine seam was shallow too. `AgentEngine` was `{ kind }` and `PiEngine`
passed `.harness` through, so `AgentRuntime` branched on
`#claude.handles(ref)` in seven methods and kept the pi bodies inline.
Callers had to know ordering rules: sync the Claude session, then re-sync its
YOLO state after every configure, and have `setYolo` write both engines.

## Decision

- **One Tool gate** (`packages/agent/src/gate.ts`, `ToolGate`). It owns, once
  per call and memoized on the call: the gate plan and its refusal, the
  permission (`tiny.permissions`), the unattended refusal, YOLO mode
  (`tiny.yolo`, one `ownerTurn` rule over a minimal `GateUserMessage` view),
  auto-review, the Owner wait counted by the runtime's approvals
  `WaitTracker`, and result redaction. Its interface is
  `run(call, execute)`, `decide(conversation, taskId, decision)`,
  `approveWaiting(conversation, by, userMessages)` (YOLO switched on),
  `waiting(conversation)` and `abandon(conversation)`.
- **Engines are thin adapters onto it.** Each hands the gate a `GateCall`: the
  call's tool api (decided-once memos, the conversation's documents, card
  details), its user messages, the bot's instructions, and where the owner's
  answer is kept. pi keeps it in the call's `tiny.approval` task document, so
  a restart re-attaches. The Claude plan's calls do not survive a restart, so
  the gate holds the answer in memory, keyed by conversation and task, and
  drops it when the turn ends. The Claude plan reads the same permissions and
  YOLO documents from the shared store, and runs its tools with a partial tool
  api (memos, conversation documents, details) that fails clearly on anything
  that needs a pi-durable task.
- **`AgentEngine` is a per-conversation interface, and everything the
  runtime calls on an engine:** `start()`, `configure(ref, compiled)`,
  `runs(ref)`, `submit`, `abort`, `withdraw`, `read`, `watch`,
  `userMessages`, `busy` and `close`. The runtime holds both engines as
  `AgentEngine` and calls nothing else on them. The runtime derives pages,
  the Bot list preview and Finished replies from `read`, the same way for
  both engines (rewrite step 2.2). `PiEngine` owns what only pi does (submit
  through the inbox, withdraw a queued submission, its chat projection and
  stream). `ClaudeCodeEngine` implements the same interface. The name stays
  `AgentEngine`, not the rewrite's `TurnRunner`: each engine still reads its
  own entry family into the chat (register C6), so it is more than a turn
  runner.
- **The conversation store** (`conversation-store.ts`, owned by the runtime)
  holds what every conversation has whichever engine runs it: creating the
  durable conversation, its agent change and permissions (stored on every
  configure, before the engines take their part), its YOLO document, the
  attachment ids of its recent sends, its history (`loadHistory`, both
  engines page their entries through it), and the task graph that says which
  conversations reply (only pi's turns are tasks). It starts before the
  engines and resumes the harness last.
- **`ClaudePlan`** (`engines/claude-code/plan.ts`) is what the Claude plan has
  apart from any conversation: its switch, fallback and turn limit, read from
  the catalog, and its worker's status, account and setup. The runtime
  exposes it as `runtime.claudePlan`; the engine reads the same state per
  turn.
- **`AgentRuntime` keeps only its own job:** the store, its lock, the Owner
  waits, the capability registry, the Tool gate, the merged busy activity,
  and choosing the engine per conversation. That includes the gateway
  fallback: an engine that answers `unavailable` has let go of the
  conversation for good (the Claude plan leaves it before answering), and the
  runtime hands the turn to pi.
- Approving and YOLO are not engine methods. They are the gate's: both
  engines' calls are answered through `ToolGate.decide` and approved through
  `ToolGate.approveWaiting`, and YOLO state is one document both read.

## Consequences

- A gate rule (a new Owner wait kind, a redaction change, a YOLO exception)
  is written once, and both engines get it. `tool-gate.test.ts` runs every
  gate case on both engines; `engine-contract.test.ts` runs the engine
  contract on both through the runtime.
- On the Claude plan, a vault tool called without a vault item now runs
  under YOLO, as on pi (the gate looks at the call's plan, not at the tool's
  `vault` flag). A denied or expired call shows as denied or expired with the
  gate's wording, as on pi.
- Tools whose plan or run needs only memos and conversation documents now
  work on the Claude plan too. Tools that need the pi-durable task API still
  return a clear error there (ADR 0008).
- A Claude plan approval still does not survive a restart: the turn it
  belongs to does not either.
- A third engine implements `AgentEngine` and hands its calls to the gate; the
  runtime needs one more entry in its engine list and a rule in `#engineFor`,
  and nothing engine-specific beside them.

## Alternatives considered

- **Keep two gates and share helpers.** Rejected: the drift came from two
  call sites deciding the order of the same rules, not from missing helpers.
- **Make the Claude plan emulate a full pi-durable tool api** (task documents,
  commits, watches) so `gateTool` could run unchanged. Rejected: it would
  rebuild pi-durable's task store in memory for calls that cannot survive a
  restart anyway.
- **Put decide and YOLO on `AgentEngine`.** Rejected: that is the ordering
  rule this ADR removes. One gate answers every call, so the engines do not
  need to.

## Links

- [ADR 0008](0008-claude-code-engine.md)
- [YOLO mode](../features/yolo-mode.md), [Auto-review](../features/auto-review.md)
- [Claude subscription](../claude-subscription.md)
