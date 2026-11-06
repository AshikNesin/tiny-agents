---
"@tiny-agents/agent": minor
---

One tool-call row for both engines. A tool call's chat row (its status,
output, timing, approval and every Owner wait card) now comes from one
projection, `tool-call-row.ts`, that the pi transcript and the Claude plan
engine both use. On the Claude plan, a call waiting on a Question, a
credential request or a takeover now shows that card instead of a bare
"running" row, and a finished call shows its sources, Code hand-off,
answers, credentials, takeover and clipped output as on pi. pi rows are
unchanged.
