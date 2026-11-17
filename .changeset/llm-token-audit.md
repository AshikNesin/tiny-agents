---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

Bots send less to the model on every request. A long chat is now summarized once its context passes about 150k tokens on every model, instead of only near the model's full window, so on a 1M-token model a single request no longer grows toward a million tokens (`CONTEXT_CEILING_TOKENS`, applied through pi-durable's per-model compaction overrides). A browser or computer session's old screenshots are no longer re-sent with each later step: only the newest three go out, and older ones drop ten at a time so the provider's prompt cache keeps working between drops (the chat still shows every screenshot, and images the owner attached are never dropped). The bots roster in the prompt no longer says which bots are "working right now", which re-sent the whole roster into the transcript every time any bot started or stopped a reply; `message_bot` still says when a message is queued. Side-calls (chat titles, memory capture) pass their prompt through the secret redactor, like tool results and logs do.
