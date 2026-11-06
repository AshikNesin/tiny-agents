---
"@tiny-agents/claude-worker": minor
---

One session log under both Claude worker protocols. Bot sessions and coding
sessions now keep their events in the same `SessionLog` (append, replay from
a cursor, the resume answer, and a set of subscribers in place of the single
`fanout` slot), exported with `Sequenced` from the package root;
`resumeResultOf` moves there from the envelope and takes a log. The server
owns the sockets, heartbeat and framing once, and each protocol is a handler
that subscribes its sockets to its sessions' logs. `Session` and
`CodingSession` lose `replay`/`firstSeq`/`lastSeq`/`fanout` (use `log`),
`CodingSession.partial` becomes `CodingBook.onPartial`, and
`SessionBook.replay` is gone. `codingSdkOf()` builds the coding SDK from the
loaded Agent SDK module without a cast. The wire protocol is unchanged.
