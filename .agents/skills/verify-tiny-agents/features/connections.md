# Connections (MCP servers)

A user connects remote MCP servers on `/connections` so bots get their tools. They add a server with a name, URL and optional header secret, test it before saving (failure reasons stay inline), see its status and tools, turn single tools off for every bot, choose which bots use the connection (here or in the bot's dialog), open a tool for its schema and a playground that calls it live, reconnect, and remove it after a warning about the bots that lose it. Broken servers are grouped under `Needs attention`.

## Sub-features

- `connections-list` groups rows under `Needs attention` (Error / Needs sign-in) and `Connected`, each with URL, `N tools · used by N bot(s)` and a status badge; empty state `No connections yet`.
- `connections-test` (`Test connection` in dialog `Add connection`): a wrong secret shows alert `Test failed` with the reason; a working server shows `Streamable HTTP · N tools found` and the tool names (`· read-only` when hinted).
- `connections-add` saves with auth `None`, `API key or header` (Header name, default `x-api-key`, and a masked `Secret`) or `Sign in (OAuth)`; toast `Connection added`, opens the detail page.
- `connections-auth-secret` is write-only: the API only says `hasSecret`; the value never appears in API reads or the page. It is stored as the connection's own vault item `mcp-<slug>` ("MCP connection: <name>" under Vault → API keys), deleted with the connection. Another vault API key can supply the header instead (`secretRef`, API only, no UI yet).
- `connections-tools` lists tools with switch `Let bots use <tool>`; off tools stay listed (`N tools · N off`) but are withdrawn from the bots' `mcp:<slug>` capability.
- `connections-bots` links bots via checkbox `Use <connection> tools in <bot>`, or switch `Enable <connection>` in the bot's `Edit <bot>` → `Tools` tab.
- `connections-tool-page` (`/connections/:id/tools/:tool`): description, server and bot-facing names, behavior badges, input/output schema, switch `Available to bots` (alert `Off for every bot` when off).
- `connections-playground` runs the tool on the live server (`Run tool` → `Success` + content). Tools without a read-only hint ask first (dialog `Run <tool>?` → `Run`); off-for-bots tools still run here.
- `connections-reconnect` (`Reconnect`, toast `Reconnect started`) and `connections-remove` (dialog `Remove connection?`, `N bot will lose these tools`, toast `Connection removed`).

## How to get to it (user POV)

- Sidebar button `Account and navigation` → menuitem `Connections` (`/connections`); also the ⌘K palette.
- A connection: its row link (`/connections/<id>`); a tool: its link in the `Tools` list.
- From a bot: `<bot> actions` → `Edit bot` → tab `Tools` → `Connections` block at the bottom.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in, `SECRETS_KEY` set (every run has one; header auth refuses without it).
- The journey starts a **real MCP server** itself: `@modelcontextprotocol/sdk` (resolved from `packages/agent`), stateless Streamable HTTP on `127.0.0.1:<free port>/mcp`, accepting only `x-api-key: key-<stamp>-c0nn`, tools `echo` (read-only, `value` string) and `reset`; `cleanup()` closes it. Loopback URLs are allowed because the run is `NODE_ENV=development`.
- A bot (`setup:` via API).

- **Add + test.** `Add connection`; Name `Verify MCP <stamp>`, URL, combobox `Authentication type` → `API key or header`; `Secret` has `type=password`. Wrong secret → `Test connection` → alert `Test failed` (server saw that key). Right secret → `Streamable HTTP · 2 tools found`, `echo · read-only`.
- **Save.** `Save` → `Connection added`, `/connections/<id>`, status polls to `connected`, links `echo`/`reset`. API: `hasSecret: true`, secret absent from `GET /connections[/<id>]` and page HTML; tool names `mcp__<slug>__echo|reset`; `GET /api/v1/capabilities` has `mcp:<slug>`.
- **Tool off.** Switch `Let bots use reset` → `2 tools · 1 off`; API tool `enabled: false`; capability drops `reset`, keeps `echo`.
- **Bots.** Check `Use <conn> tools in <bot>` → `botIds` / bot `connectionIds`. Bot dialog `Tools` tab: switch `Enable <conn>` is on; off + `Save changes`, then on + save, each read back.
- **Tool page.** Link `echo` → heading `echo`, `mcp__<slug>__echo`, `Available to bots` on; textbox `value` → `Run tool` → `Success`, `echo:hi <stamp>`. `/connections/<id>/tools/reset`: `Off for every bot`; `Run tool` → dialog `Run reset?` → `Run` → `reset done` (server counted one call); `Available to bots` on → `Bots can use this tool`.
- **Reconnect.** Breadcrumb link → `Reconnect` → toast; status back to `connected`, the server saw new requests.
- **Vault header (API only).** Step-up, create an API-key vault item holding a new key, `PATCH /connections/<id> { secretRef }`, server accepts only that key now, `Reconnect` in the UI → `connected`, server saw the vault value; neither read leaks it.
- **Needs attention.** Add `Verify Broken <stamp>` at a closed loopback port → status `error`, badge `Error`; list shows `Needs attention` with it; the good row shows `2 tools · used by 1 bot`.
- **Remove.** `Remove` → dialog says `1 bot will lose these tools` → `Remove` → toast, back on the list, row gone, capability gone, bot unlinked.
- **Proof.** `ta-verify drive $S/journeys/connections.mjs` → `connections/test-failed`, `test-passed`, `connected`, `reset-off`, `bot-dialog-connection`, `tool-echo-ran`, `tool-reset-ran`, `list-attention`, `removed`.

## Gotchas

- The SDK is not a root dependency: resolve it with `createRequire("packages/agent/package.json")`.
- The tool row link's name starts with the label and continues with the description and `read-only`; match `^echo\b`.
- The status starts as `connecting`; poll `GET /connections/<id>` instead of asserting the badge right after save.
- No UI edits a saved connection's name, URL or secret, or sets `secretRef`; only bots, tool switches, reconnect and remove are editable in the UI.
- A bot actually _calling_ `mcp__<slug>__*` needs a real model (the faux model only echoes): proof stops at the tool being installed in `mcp:<slug>` and linked to the bot. `Sign in (OAuth)` needs an OAuth authorization server and a popup round trip; it is not driven.
