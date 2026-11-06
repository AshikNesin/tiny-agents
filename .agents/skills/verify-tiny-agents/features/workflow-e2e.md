# Workflow: set up an agent end to end

This is the way an owner builds a working agent: create a bot, give it a skill, keep an API key in the vault, connect an MCP server that authenticates with that vault key, link the connection to the bot, and schedule a routine for it. The routine then runs by itself, and its result shows in the bot's chat as a quiet line. Because it needs nothing from the owner, it raises no attention signal. A question from the bot still does. After a reload the skill, the connection and its tools are all still wired to the bot.

## Sub-features

- `wf-bot`: a bot created from `New bot` with the default `Test Model (faux)`.
- `wf-skill`: a skill created from `New skill` and attached with checkbox `Use <skill> with <bot>`.
- `wf-vault-key`: a local vault `API key` saved after the step-up `Confirm it's you`. Its handle is taken from the name. Under `Activity`, the item later shows `used · mcp` with target `mcp:<slug>`.
- `wf-connection`: an `Add connection` with `API key or header`. A key typed into the dialog is refused by the server (`Test failed`, status `error`). Once the header points at the vault item, `Reconnect` connects and lists the tools. Neither the page nor the API ever contains the key.
- `wf-link`: checkbox `Use <connection> tools in <bot>` links the connection. The bot's `connectionIds` and the `mcp:<slug>` capability (`mcp__<slug>__echo|reset`) follow.
- `wf-routine`: a `Once` routine for the bot, 1–2 minutes ahead, that fires on its own (`schedule:succeeded`, job `completed`) and appears in the chat as a `routine-runs` line that reads `done`.
- `wf-attention`: while the run fires and finishes, the tab title has no `(N)`, the sidebar row is named just the bot (no unread or waiting label) and the favicon is `/favicon.svg`. In the same chat, `/ask` shows `(1)`, `1 question for you` and a badged favicon, and answering clears all three (features/notifications.md).
- `wf-wired`: after a reload, the API shows the skill, the connection (`connected`, `secretRef`) and its tools on the bot. `Edit <bot>` has `Assign <skill>` and `Enable <connection>` on, the Connections list shows `2 tools · used by 1 bot`, and `Recent runs` has the `schedule` run.

## How to get to it (user POV)

- Bot: `New bot` on `/chats`. Skills, Vault, Connections, Routines: sidebar `Account and navigation` → the matching menuitem.
- The bot's settings: `<bot> actions` → `Edit bot` → tabs `Skills` and `Tools` (the `Connections` block).

## Driving it with ta-verify

Preconditions:

- A baseline run, doctor OK, signed in, with `SECRETS_KEY` set (every run has one) and Pushover `not_configured`; the journey checks this first.
- The journey starts its own **real MCP server**, the same way `connections.mjs` does: the app's `@modelcontextprotocol/sdk`, resolved from `packages/agent`, with stateless Streamable HTTP on `127.0.0.1:<free port>/mcp` and tools `echo` and `reset`. It accepts only `x-api-key: wf-vault-<stamp>-K3y`, the vault value. Nothing else is set up through the API: every row is created in the UI.
- One login and one vault step-up (two if the step-up token has expired by cleanup time).

- **Bot.** `New bot` → `Name` `WF Bot <stamp>` → `Create bot`, then read the row back from `GET /bots`.
- **Skill.** `Skills` → `New skill` (`wf-skill-<stamp>`) → `Create skill` → checkbox `Use <skill> with <bot>` → the bot's `skillIds` include it.
- **Vault.** `Vault` → `New item` → `API key`. Set `Name` to `WF key <stamp>`; `Handle` becomes `wf-key-<stamp>`. Fill `Key`, press `Save`, then `Confirm it's you` → `Password` → `Confirm`. You land on `/vault/items/<handle>`, where Activity shows only `created · vault_ui`.
- **Connection.** `Connections` → `Add connection`: Name `WF MCP <stamp>`, the URL, `API key or header`, `Secret` set to a typed key → `Test connection` → `Test failed` (the console logs a 400 for this) → `Save` → toast `Connection added`, and the status polls to `error`. API only: `PATCH /connections/<id> { secretRef: <handle> }`. Then reload → `Reconnect` → toast `Reconnect started`; the status polls to `connected`, the server saw the vault value, the API row shows `hasSecret` and `secretRef`, the links `echo` and `reset` appear, and no read contains the key.
- **Link.** Check `Use <connection> tools in <bot>`. The connection's `botIds`, the bot's `connectionIds` and the capability `mcp:<slug>` (both tools) all update. The vault item's Activity shows `used · mcp … mcp:<slug>`.
- **Routine.** `Routines` → `New routine`: the bot, prompt `workflow check <stamp>`, name `wf-routine-<stamp>`, tab `Once`, `Run at (IST)` = the next-but-one minute boundary → `Create`. One `created` job is queued.
- **Quiet while it runs.** Click `Tasks`: title `Tasks · tiny-agents`, sidebar link named exactly the bot's name, favicon `/favicon.svg`. Poll `GET /routines/<id>/runs` until it returns `[schedule:succeeded]`, for up to (time left until the slot) + 120 s; the job is `completed`. Three seconds later the title, link name and favicon are unchanged, there is no `Unread` dot, and the bot list shows `unread: false, approvals: 0, questions: 0, replying: false`.
- **Chat.** Click the sidebar row: the `routine-runs` line shows `done`, and opened it has `data-status=succeeded`, the prompt and no `run now`.
- **Signal control.** Send `/ask set up the project` → `question-card`, title `(1) <bot> · tiny-agents`, label `1 question for you`, badged favicon. Answer it (`React`, `Auth`, `Next`, text, `Send answers`): the count and the badge clear.
- **Still wired.** Reload, then check: the line is still there; the API shows the skill and connection on the bot, the connection `connected` with its `secretRef` and its two tools, the capability with both tools, and the routine `done`. In `Edit <bot>`, `Skills` → `Assign <skill>` is on and `Tools` → `Enable <connection>` is on (then `Cancel`). The Connections row shows `2 tools · used by 1 bot`, and `Recent runs` has the `schedule` + `succeeded` run.
- **Cleanup** runs in this order: routine, connection, vault item (purged, with a fresh step-up if needed), skill, bot, the routine's `routine-fire` jobs, then the MCP server.
- **Proof.** `ta-verify drive $S/journeys/workflow-e2e.mjs` → `workflow-e2e/skill-attached`, `vault-item`, `connection-refused`, `connection-linked`, `vault-used`, `routine-armed`, `quiet-after-run`, `chat-line`, `attention-question`, `bot-wired`, `pages-after-reload`.

## Gotchas

- No UI sets a connection's `secretRef` (features/connections.md), so pointing the header at the vault item is the one step done through the API. The UI's `Reconnect` and the server's own log of received keys prove it took effect.
- A routine's run happens in its own conversation, so it never marks the bot unread, never shows `Replying` in the sidebar and never adds to the title count. The quiet line is the only trace it leaves in the chat. That is the documented behaviour, not a missing signal.
- What the faux model cannot show: the routine actually using the skill, calling `mcp__<slug>__echo`, or reading the vault item. The faux model only echoes the labelled prompt, so the proof ends at the pieces being linked to the bot and installed (`mcp:<slug>`). A real tool call from a routine needs a real provider.
- The capability lists full tool names (`mcp__<slug>__echo`), not the server's bare names.
- The fire takes about 100 s, and the whole drive about 2.5 minutes.
