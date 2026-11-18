# Traces

Every LLM call the bots make, read from the conversations the app already stores (issue #363). The list groups sessions by day with model, tokens and cost; a session's page shows its totals and each turn's model and tool calls. Side-calls (memory capture, titles, auto-review) are a filter of their own. Read only.

## Sub-features

- `traces-summary` line `Last 7 days · $… · … tokens · N sessions · N side-calls`.
- `traces-filters` buttons `All`, `Chats`, `Routines`, `Bot to bot`, `Side-calls` (`aria-pressed`).
- `traces-list` rows `trace-session`: title, `<bot> · <kind> · <model>`, tokens, cost, time; links to `/traces/<conversation id>`.
- `traces-session` totals (Cost, Input with cached %, Output, Model calls, Tool calls, Failed), then `trace-turn` cards newest first with `trace-call` and `trace-tool` rows; `Open chat` links to the chat.
- `traces-side-calls` rows `trace-side-call`; empty state `No side-calls yet`.

## How to get to it (user POV)

- Sidebar account button `Account and navigation` → menu item `Traces` (`/traces`).

## Driving it with ta-verify

Preconditions: baseline run, doctor OK, signed in. Journey: `journeys/traces.mjs`.

- **List.** Create a faux bot (API), send a message in its chat, open Traces: the row shows the bot, `Chat` and `test-model`.
- **Session.** Click the row: the turn shows the message and a `test-model` call; `Open chat` goes to `/chats/<bot>`.
- **Side-calls.** Faux mode makes no side-calls, so the filter shows `No side-calls yet`.

Unreachable here: real costs (the faux model prices at zero) and side-call rows (faux mode passes no side-caller); the server tests cover both.
