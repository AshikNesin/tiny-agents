---
"@groot/web": minor
"@tiny-agents/agent": patch
---

Turn individual MCP connection tools on or off for every bot, and open any tool on its own page. Each row in a connection's tool list now has a switch and links to `/connections/:id/tools/:tool`, which shows the tool's description, behavior hints (read-only, idempotent, destructive, open world), input and output schema (as fields or raw JSON Schema), an "Available to bots" switch, and a playground that calls the tool on the live server from a generated form or a JSON editor. Tools that may change data ask before running. Turned-off tools are kept in the new `Connection.disabledTools` column, are never installed into the runtime (so no bot sees them, whatever its own permissions say), and stay off across reconnects; tools a server adds later start on. New endpoints: `GET`/`PATCH /connections/:id/tools/:tool` and `POST /connections/:id/tools/:tool/call`. The agent package's cached MCP tool info now carries `outputSchema` and the destructive/open-world hints, and call results carry `structuredContent`.
