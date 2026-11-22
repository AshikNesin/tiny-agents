# ADR 0020: A native Code harness on the agent runtime

- Status: **accepted** (builds on [0011](0011-code-harness-adapters.md), [0013](0013-one-sandbox-connection.md), [0014](0014-tool-gate-and-engine-seam.md))
- Date: 2026-11-22

## Context

Code drove two coding agents, Shelley and Claude Code. Each needs something
the owner may not have: a Shelley server, or a Claude subscription. The app
already runs a durable agent loop for its chat bots (pi-durable behind
`AgentRuntime`), with a Tool gate, approvals, questions, steering and a
queue. Issue #297 planned a third harness on that loop, and the Code rebuild
needs one that runs with no outside service, so the workspace can be built
and verified on the faux model.

Three things had to be decided: where the driver lives and how it reaches
the runtime, what the coding tools are, and what the contract's fuzzy edges
mean for this harness.

## Decision

**A third driver behind the same contract.** `packages/code/src/drivers/pi`
is a `HarnessInstance` like the other two: instance id `pi`, kind `pi`,
label Native. Like Claude Code it has no thread list of its own, so its
threads are rows in the host's `ThreadIndex`, and it feeds one `ThreadFeed`
per watched thread with the whole row list. A thread's native id is the
runtime's conversation id.

**The driver takes the runtime through a port.** `packages/agent` stays the
only package that imports pi-durable, and `packages/code` imports neither
(lint rule R11). The driver declares what it needs in `drivers/pi/port.ts`:
a narrow `PiPort` and the chat-state types, written structurally.
`code.registry.ts`, the one file that may name a harness's package, adapts
`AgentRuntime` to the port and maps the runtime's errors to `HarnessError`.
TypeScript checks the two shapes against each other there, so a chat-state
change that the driver does not know breaks the build, not a thread.

**The runtime gains only what the driver lacked.** A working directory on a
conversation's config (`BotAgentConfig.cwd`, stored as pi-durable's agent
`cwd`), `fork`, `compact` and `continueReply`. A queued message carries when
it was sent, and a tool row carries a command's exit code and an edit's
diff. pi-durable cannot delete a conversation, so the harness has no
`remove` and its `threads.delete` capability is off.

**Coding tools are a toolkit, not an `ExecutionEnv`.** pi-durable ships
`read`, `write`, `edit` and `bash` tools that run on an `ExecutionEnv` the
host implements. We wrote our own five tools (`read`, `write`, `edit`,
`bash`, `find`) with `defineToolkit`, as the sandbox toolkit is written:

- The Tool gate wraps capability tools only (`gateExtension`). pi-durable's
  coding tools would run outside it, so permission modes, approvals, the
  run's tool-call cap and auto-review would each need a second
  implementation.
- An `ExecutionEnv` is a file system and process API with dozens of methods
  to implement and keep in step with pi-durable. The tools need three calls
  the app already has: `exec`, `readFile` and `writeFile` on the one
  `SandboxConnection` (ADR 0013).
- Nothing may run on the app's host. With one connection passed in and no
  environment, there is no local fallback to reach by mistake.

Every tool resolves a relative path against the conversation's `cwd`, and
`bash` and `find` run after `cd <cwd> &&`. `edit` replaces exact text, once
unless told to replace all, and answers with the unified diff. The toolkit
also owns its part of the system prompt, rendered from the conversation's
`cwd` and the tools it is offered.

**Permission modes are the gate's per-tool permissions.**
`codingSelection(mode)` is the one mapping: `default` allows `read` and
`find` and asks for the rest; `acceptEdits` also allows `write` and `edit`;
`plan` turns `write`, `edit` and `bash` off, and the prompt section then
says to plan without changing files; `bypassPermissions` allows everything.
A call that asks is a `request` row, answered through `decideApproval`; an
`ask_owner` call is a question row, answered through `answerQuestions`.

**What the contract's edges mean here.**

- `fork(nativeId, at)` includes the message `at`, as pi-durable's fork and
  the Claude Code driver's do. A fork at a user message ends in that
  message, unanswered; `recover("continue")` answers it. That is Retry. An
  Edit forks at the message before it (the driver takes any message id as
  `at`, not only a user row's `forkAt`) and sends the new text.
- A turn row is written where a turn ended: after an answer with no tool
  calls, after an error, and after a stop. A message sent while a reply
  streams its final answer is answered next and reads as a turn of its own.
- Stop withdraws the owner's queued messages, as it does in a bot's chat.
- A steer waits in the queue until the running tool round ends, so the
  queue lists steers as well as held messages.
- The model a new thread starts on is the `code_default` role, which falls
  back to `bot_default` and only ever answers a model that runs on pi.

**The faux model can drive it.** `/bash`, `/read`, `/write`, `/edit`,
`/find` and `/sleep` make the faux model call the matching tool, so every
part of the harness runs with no model key.

## Consequences

- Code works with only a sandbox and one pi model. The rebuild can make
  this harness the default once the owner has tried it on the real VM.
- A native thread is an ordinary conversation in the agent store: it
  survives restarts, compacts itself at the context ceiling, and its usage
  shows in Traces.
- The gate's cap on tool calls in one run applies to coding turns too. A
  long task ends with the agent told to wrap up, and the owner continues it.
- Stopping a turn closes the SSH channel of a running command. Whether the
  process dies with it is up to the sandbox's sshd; a server started with
  `nohup` keeps running.
- The harness serves no diffs, file search, uploads or folder browser of its
  own. In a project thread the app's own git reader covers the first.
- The transcript shows no context use: the runtime reports cost, not the
  tokens now in context.

## Alternatives considered

- **pi-durable's `CodingTools` on an `ExecutionEnv` over SSH.** Rejected for
  the three reasons above. It would be the way back if we wanted pi's tools
  unchanged.
- **Import `@tiny-agents/agent` from `packages/code`.** Shorter by one
  adapter, but it puts pi-durable's types one import from the Code layer,
  which ADR 0011 keeps free of any one harness.
- **Run the loop in the Claude worker on the sandbox.** Tools would run next
  to the files, but a second runtime would need its own store, gate and
  model credentials on the VM.
- **`fork` excludes the message.** It would make Edit one call, but it
  disagrees with the Claude Code driver, and a fork at the first message
  would have nothing to fork.
