---
"tiny-agents": minor
---

Traces: a new page lists every LLM call your bots make, grouped by session (chats, Past chats, routine runs, bot-to-bot messages) with model, tokens, cache use, cost and timing per call and per tool. It reads the conversations the app already stores and adds no model calls. Side-calls (memory capture, chat titles, Code naming, auto-review) now keep one metadata row each in `llm_calls`, never the prompt or the answer, pruned after 30 days.
