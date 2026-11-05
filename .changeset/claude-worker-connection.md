---
"@tiny-agents/claude-worker": minor
"@tiny-agents/agent": minor
"@tiny-agents/code": minor
---

One Worker connection for both Claude worker clients. `@tiny-agents/claude-worker/client`
exports `connectWorker(resolveTarget, options)`, which owns the heartbeat and
silence close, reconnecting with backoff (finding the worker again on every
attempt), the handshake, worker restart detection by the `welcome` boot id, a
resume cursor per session, requests and their replies (sent again on the next
socket while unanswered), the queue while disconnected, and the wording of a
refused token or an HTTP status. The Claude plan bot engine and the Claude Code
harness are thin protocol layers on it.

The worker's socket envelope is shared: `welcome` carries `bootId`, every
request is answered with `reply` (was `coding.reply`), and the bot protocol's
`resume` takes a `requestId` and answers where the session is before it
replays.

The Claude plan engine gains what only the harness had: it finds the worker
again on every reconnect instead of caching its first address, and a worker
restart ends the turn it was running with a visible error ("The Claude worker
restarted…") instead of leaving the chat busy forever. A turn still waiting to
be sent goes to the new worker. Its tool calls stay idempotent, and replaying
an old turn never runs its tools again (bot sessions join at the worker's
latest event).

The worker labels `.avif` assets `image/avif`, matching the Code page.
