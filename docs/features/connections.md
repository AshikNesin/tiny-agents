# Connections (remote MCP servers)

A connection is a remote MCP server (Streamable HTTP, falling back to legacy
HTTP+SSE) whose tools become a capability named `mcp:<slug>`, with tools named
`mcp__<slug>__<tool>`. Code lives in `apps/web/src/server/api/connections/`
and `packages/agent/src/mcp.ts`; the UI in
`apps/web/src/client/pages/connections/`.

## Who gets which tool

Three switches decide whether a bot can run a connection tool, outermost
first:

1. **Tool on the connection** (`Connection.disabledTools`). A tool turned off
   here is never installed into the runtime, so no bot sees it. It stays off
   across reconnects and tool-list changes; tools the server adds later start
   on.
2. **Connection on the bot** (`BotConnection`). Per bot, from the bot dialog
   or the connection's "Used by bots" list (ADR 0004: connections stay a
   per-bot choice).
3. **Tool permission on the bot** (`Bot.toolPermissions`: allow / ask / off).

Turning a tool on or off re-installs the capability from the cached tool list
and re-applies every linked bot's configuration (`ConnectionManager.reinstall`).
Servers with more than `MCP_DEFER_THRESHOLD` tools defer them behind
`tool_search`; the count uses the tools that are on.

## Tool page

`/connections/:id/tools/:tool` (the tool's server name, URL-encoded) shows the
description, behavior hints, input and output schema, the "Available to bots"
switch and a playground. The playground calls the tool on the live connection
as the owner, including tools turned off for bots. Tools without a read-only
hint ask for confirmation first, because the call runs for real.

## API

| Method & path                                   | Body                     | Returns                                                             |
| ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `GET /api/v1/connections/:id/tools/:tool`       | —                        | The tool with `inputSchema`, `outputSchema?`, hints, `enabled`      |
| `PATCH /api/v1/connections/:id/tools/:tool`     | `{ "enabled": boolean }` | The updated tool                                                    |
| `POST /api/v1/connections/:id/tools/:tool/call` | `{ "arguments": {…} }`   | `{ result: { content, structuredContent?, isError? }, durationMs }` |

Each tool in `GET /api/v1/connections/:id` also carries `serverName` and
`enabled`. A call that fails before the tool runs (connection down, protocol
error) answers 400 with the reason; a tool that runs and reports an error
answers 200 with `result.isError: true`.

## Header secrets from the vault

A header-auth connection can read its header value from a [vault](./vault.md)
item instead of the stored encrypted value: `PATCH /api/v1/connections/:id`
with `{ "secretRef": "<handle>" }` (null goes back to the stored value;
setting a new `secret` clears the reference). The value is resolved when the
connection connects, audited, and scrubbed from logs; the item must allow the
`mcp` tool (API keys do by default) and be switched on.
