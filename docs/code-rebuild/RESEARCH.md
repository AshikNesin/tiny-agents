# Code workspace rebuild: research

Ideas taken from four reference products for the rebuild in
[`SPEC.md`](./SPEC.md). Nothing was copied. Everything here comes from
reading each project's public docs and source on 22 November 2026; none of
the apps was run. t3.chat itself refused the fetch, so its entry rests on
T3 Code alone.

## T3 Code

Source: <https://github.com/pingdotgg/t3code>, its user and internals docs
and its default keybinding table.

Adopt:

1. **One composer key, one button that names the busy state.** An empty
   draft shows Interrupt; typing turns it into steer or queue, and a
   modifier flips the choice for one message. Queued messages live on the
   server and can be edited, sent now or removed.
2. **Two diffs, kept apart.** "This turn" shows only what the agent just
   changed; the branch comparison shows everything against the base.
   Checkpoints are hidden git refs, so a rewind adds no commit to the branch.
3. **Undo instead of confirm.** Pin, settle, archive and discard act at once
   and show a short Undo notice.
4. **A thread-scoped stream.** The list snapshot is small, a thread's
   history is paid for only by a client viewing it, and a short idle cache
   makes going back instant.
5. **A status-driven list.** A thread waiting on background work sinks to a
   Working section and returns to the top when it needs an answer; a merged
   pull request settles its thread.

Avoid:

1. **Overloaded shortcuts.** One chord means three things depending on
   focus, so the docs need a precedence section. Keep keys few and show them
   in the palette.
2. **Multi-environment machinery.** Pairing, relays and per-environment
   settings serve remote multi-device use, which one owner on one server
   does not need.

## Jean

Source: <https://github.com/coollabsio/jean>, its architecture guide,
keyboard shortcut doc and automation doc. Its worktree naming, setup scripts
and prompt text were not readable from the docs.

Adopt:

1. **An explicit origin on automated work.** Automation-owned worktrees
   carry a field saying so; nothing is inferred from names or status. Here
   that is the trigger on a run.
2. **Server-owned run state with a version.** A client reconciles from a
   snapshot on reconnect and on focus instead of trusting what it last saw.
3. **The queue lives on the server.** Clients only draw it, and a steer that
   fails falls back to the queue.
4. **Long actions return at once.** Opening a pull request or starting a
   review hands back a job, and the interface shows progress on it.
5. **A pull request or issue as the start of a task.** Checking one out into
   a worktree is the first step, not a separate mode.

Avoid:

1. **Many backends.** Ten agent CLIs, each with its own mode mapping,
   approval model and resume id, cost a long checklist per backend.
2. **Process supervision layers.** Detached hosts, socket steering and log
   tailers exist to keep CLI processes alive across restarts.

## Shelley

Source: <https://github.com/boldsoftware/shelley>, its loop and conversation
manager and its tool card components.

Adopt:

1. **Steer joins at the next model request.** A message sent mid-turn is
   taken after the current tool round and recorded then, so the transcript
   order is the order the model saw.
2. **Two different stops.** Send now interrupts and keeps the queue; Cancel
   interrupts and clears it. The interface says which is which.
3. **Cancelled tools still answer.** A cancelled or never-started tool call
   gets a fixed result after a short grace period, so history stays valid.
4. **Quiet tool cards.** One summary line per call, a live tail while a
   command runs, folded when it finishes; patches show their diff.
5. **Retry resends, it does not re-ask.** Retry repeats the failed request
   without adding a user message, and is offered only on a retryable error.

Avoid:

1. **Turns nobody asked for.** Idle compaction and cache keep-warm start
   model calls in the background.
2. **One huge screen component and two stream protocols.** Both make the
   interface hard to change.

Shelley has no edit of an earlier message, only fork. That is why Edit in
the spec is a rewind.

## AgentsInTheCloud

Source: <https://agentsinthecloud.com> and
<https://github.com/lucasmeijer/AgentsInTheCloud>, its README and glossary.

Adopt:

1. **One work view beside the agent.** Terminal, files and changes share one
   pane, one at a time, with no split groups to manage.
2. **Next attention.** One action jumps to the next thing that needs the
   owner.
3. **Prompt templates with a key.** A saved prompt goes straight to the
   active agent; here those are the workflows.
4. **Secrets stay outside the sandbox.** Agents get a placeholder, which
   this app's vault already does.

Avoid:

1. **A container per workspace** with a hosted editor and a remote desktop.
   It isolates well and is a far larger build than a worktree per thread.
