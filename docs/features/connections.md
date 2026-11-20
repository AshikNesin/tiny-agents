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
Servers whose tool schemas pass `MCP_DEFER_CHARS` (8,000 characters, by
size rather than count) defer them behind `tool_search`
(`packages/agent/src/mcp.ts`), as the browser and computer toolkits do; the
runtime's tool search capability names each deferred group in the prompt,
and lists a deferred connection's tool names so the model knows what to
search for. The parsers for the tool columns and a bot's whole selection
live in `apps/web/src/server/api/bots/bot-toolkits.ts`.

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

## Stored secrets

A connection's header value is a [vault](./vault.md) item (Q4,
[ADR 0019](../adr/0019-vault-values-table.md)). Entering a `secret` on a
header-auth connection writes it as the connection's **own item**: an API key
with the handle `mcp-<slug>` (`mcp-<slug>-2`… when taken), labelled
"MCP connection: <name>", usable only by the `mcp` tool and by no bot.
`connections.secret_item_id` links it; the row and the item are written in one
transaction. It goes only to the hosts it lists (the connection's host): each
connect checks the URL's host against them, as `http_request` does. A new
`secret` replaces the item's value in place and resets its policy (audience,
origins, hosts, injection) to that, so an edit made on the Vault page can't
leave it unreadable; removing the connection deletes the item. The Vault page
lists it under API keys, where it can be revealed, rotated or given to bots
like any other item, but not deleted: that answers 409 and points to the
connection.

OAuth state (`oauth_enc`) stays on the row, sealed with `SECRETS_KEY` under the
`connection` purpose and bound to its row and column; each change to it is one
read-modify-write in a synchronous transaction, so concurrent sign-in steps
can't overwrite each other (C11). See the vault's
[local backend](./vault.md#local) for the format and `pnpm secrets:rotate`. An
OAuth state that no longer opens (the pre-v2 `v1` format, or another key) puts
the connection in `needs_auth` ("Sign in again"), and signing in replaces it;
with no `SECRETS_KEY` at all it stays in `error`.

Before Q4 the header value itself was sealed in `secret_enc`. The first start
on Q4 moves each one into the connection's own item, checks it and clears
`secret_enc` (`apps/web/src/server/api/vault/vault.import.ts`). One that can't
be opened (no `SECRETS_KEY`, another key) stays, the start logs why, and the
connection reports it until the next start moves it or the owner enters the
value again.

Where a connection points and what it sends are guarded like a model
account's: adding a connection, deleting it, and changing its URL, header
name, secret or `secretRef` need a fresh vault step-up (`X-Vault-Step-Up`,
403 `step_up_required` without one). Renaming and choosing bots don't. A URL
that moves to another host deletes the connection's own item unless the same
change sends a new value (`secretRef: null` doesn't keep it), and drops the
reference unless the same change names one, so a stored secret never follows
the URL somewhere else.

## Header secrets from the vault

A header-auth connection can read its header value from another
[vault](./vault.md) item instead of its own: `PATCH /api/v1/connections/:id`
with `{ "secretRef": "<handle>" }` (null goes back to the connection's own
item; setting a new `secret` writes its own item and clears the reference).
Either way the value is resolved when the connection connects, audited, and
scrubbed from logs; the item must allow the `mcp` tool (API keys do by
default) and be switched on, and a chosen item must be a bots item: an
app credential (a model account's key) is refused.
