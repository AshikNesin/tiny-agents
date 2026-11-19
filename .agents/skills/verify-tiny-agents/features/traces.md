# Traces

Every LLM call the bots make, read from the conversations the app already stores (issue #363). The list groups sessions by day with model, tokens and cost; a session's page shows the whole interaction as a transcript: each prompt, the model's thoughts and replies, and every tool call with its input and output, with a sidebar that counts and filters each kind of event. Side-calls (memory capture, titles, auto-review) are a filter of their own. Read only.

## Sub-features

- `traces-summary` line `Last 7 days · $… · … tokens · N sessions · N side-calls`.
- `traces-filters` buttons `All`, `Chats`, `Routines`, `Bot to bot`, `Side-calls` (`aria-pressed`).
- `traces-list` rows `trace-session`: title, `<bot> · <kind> · <model>`, tokens, cost, time; links to `/traces/<conversation id>`.
- `traces-session` one totals line `trace-totals` (cost, input with cached %, output, model calls, tool calls, failed), then `trace-turn` items oldest first: `trace-prompt`, `trace-thinking` (opens to the thought), `trace-response`, `trace-tool` (opens to Input and Output), `trace-compaction`, and a meta line (turn, time, model, tokens, cost). `Open chat` links to the chat.
- `trace-filters` group `Filter the transcript`: Prompts, Agent responses, Thinking, Tool calls (one row per tool), Compaction, each with a count; nothing checked shows everything. On a phone it folds under `Filter` above the transcript.
- `traces-side-calls` rows `trace-side-call`; empty state `No side-calls yet`.

## How to get to it (user POV)

- Sidebar account button `Account and navigation` → menu item `Traces` (`/traces`).

## Driving it with ta-verify

Preconditions: baseline run, doctor OK, signed in. Journey: `journeys/traces.mjs`.

- **List.** Create a faux bot (API), send `/trace …` in its chat (the faux model thinks, replies, runs `list_tasks`, then thinks and answers), open Traces: the row shows the bot, `Chat` and `test-model`.
- **Session.** Click the row: the turn shows the prompt, two thoughts, the replies and the tool call; opening the tool shows its input `"status": "todo"` and output. Checking Tool calls hides everything else. At phone width the filter folds under `Filter`.
- **Side-calls.** Faux mode makes no side-calls, so the filter shows `No side-calls yet`.

Unreachable here: real costs (the faux model prices at zero) and side-call rows (faux mode passes no side-caller); the server tests cover both.
