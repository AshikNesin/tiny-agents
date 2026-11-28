# ADR 0018: Claude plan transcripts are durable entries

- Status: **accepted** (amends [0014](0014-tool-gate-and-engine-seam.md) and
  [0008](0008-claude-code-engine.md))
- Date: 2026-11-14
- Fixes: C1, C2, C3, C4 and C23, the rewrite's names for the bugs below

## Context

ADR 0014 gave both engines one `AgentEngine` seam, but the Claude plan kept
its transcript apart from the store: an in-memory `ChatMessage[]` per
conversation, written whole to `<agent.db>.claude.json` after each change.
That one choice caused a family of bugs:

- `submit` had no request-id check (a retry duplicated the message), no
  queue (a second send overwrote the running turn), and it returned only when
  the whole turn ended, owner waits included, so the HTTP send blocked (C1).
- A later worker event could flip a stopped reply back to done, a paused
  turn lost the owner's message, a reply with no text never finished for
  readers, and a corrupt or half-written file silently lost every transcript
  (C2).
- After a restart the runtime did not know which conversations ran on the
  Claude plan until their next configure, so reads showed the pi transcript
  (C4).

On the worker, Stop did not stop the SDK query and a usage pause never
resolved the turn's waiter (C23), and a proxied tool call timed out after
120 seconds while an owner wait can last much longer (C3).

Prototype P2 showed that the Claude plan can write entries of its own kinds
into the conversation's pi-durable conversation: `tx.appendEntry` after a
`tx.scanEntries` request-id check, in one commit, deduplicates a retry, the
entries survive a reopen, and pi creates no task for them.

## Decision

- **The transcript is entries.** Each Claude plan message is admitted as a
  `claude.user` entry (`{requestId, text, createdAt, peer?, author?,
  attachments?}`) in the same commit that checks its request id is not there
  yet. Each turn's reply is a `claude.assistant` entry (`{turnId, text,
  status, error?, model?, toolCalls?, createdAt}`), written when a tool call
  finishes (status `streaming`) and when the turn ends; the newest one per
  turn wins. Queued messages withdrawn before their turn ran are a
  `claude.withdrawn` entry. None of them carries model context, so pi never
  reads them and pi's chat never shows them (register C6 stays as it is).
- **Turns run one at a time per conversation.** `submit` returns once the
  message is admitted. A message sent while a turn runs waits for the next
  one, in order; a steer waits too, because the worker runs one Claude Code
  turn at a time and cannot add a message to a running one. Stop ends the
  running turn once, writes it `stopped` and withdraws the queue, and any
  later worker event for that turn is ignored.
- **Which conversations run on the Claude plan is a document.** The session
  document `tiny.claude-plan` holds each conversation's Claude session id and
  whether it left for pi. The engine reads it at open, so reads after a
  restart go to the Claude plan transcript.
- **The old file is imported once.** At open, `<agent.db>.claude.json` is
  imported into entries and the document in one commit, then renamed
  `<path>.imported`. A file that cannot be read or parsed is left as it is
  and reported.
- **An owner wait keeps the worker's tool timer alive.** While a proxied call
  waits on the owner, the app sends `tool_waiting` every 30 seconds and the
  worker starts the call's 120-second timer over. The timer still ends calls
  of an app that went away.
- **The worker stops what it stops.** Stop and a usage pause end the turn
  and close the SDK query; the session keeps its Claude session id, so the
  next turn resumes it.

What does not change: a Claude plan turn and its owner waits still do not
survive a restart (ADR 0014). A turn cut off by one reads as an error (when
part of its reply was written) or its message as unanswered. The chat's
message shape and ids (`u-<requestId>`, `a-<turnId>`) stay as they were.

## Consequences

- One store, one lock, one backup: the Claude plan transcript is in
  `agent.db` with everything else, written in commits.
- `submit` means "admitted" on both engines, and the Claude plan has a queue
  the owner sees and can withdraw from, as on pi.
- A reply that finished with nothing in it is a message (empty, `done`), as
  on pi, so `finishedReplyTo` answers its request.
- The chat projection is still written twice (pi's entries, the Claude
  plan's entries). Step 2.2 of the rewrite merged them after this landed,
  so no adapter was written over the old in-memory transcript.
- The worker protocol gains one client message (`tool_waiting`); an older
  worker answers it with a `bad_message` error the app ignores, and the app
  and worker ship together anyway.

## Alternatives considered

- **Keep the JSON file, written atomically.** Rejected: it fixes the corrupt
  write only, and leaves two transcript stores, two request-id stories and
  the restart routing (D4).
- **Write the reply only when the turn ends.** Rejected: a tool round that
  finished (a mail sent, a page changed) would leave no trace after a crash.
- **Raise the worker's tool timeout to the longest owner wait.** Rejected:
  an approval waits as long as the owner takes, and a long timer would also
  keep a turn of an app that went away holding the worker's one running
  turn.

## Links

- [ADR 0008](0008-claude-code-engine.md), [ADR 0014](0014-tool-gate-and-engine-seam.md)
- [Claude subscription](../claude-subscription.md)
