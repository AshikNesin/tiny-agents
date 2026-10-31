---
"@tiny-agents/agent": minor
---

Finished replies are matched to what they answer by request id, not by
timestamps. `finishedReplyTo(state, requestId)` returns a submission's turn
outcome (`answered` with the turn's last message, every refused tool and the
newest blocked reason; `pending`; or `unknown`), so a mid-turn "Let me
check…" never stands in for the answer and two queued submissions never swap
replies. Every user message now records its submit request id on its entry
(not only sends with attachments or peer attribution), so clients confirm an
Echo by id. `lastMessage` and the diagnostics grouping read those entries as
user messages too.
