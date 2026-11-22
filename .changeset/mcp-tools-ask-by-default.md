---
"@tiny-agents/agent": patch
"tiny-agents": patch
---

MCP connections ask before every tool by default. A server's own `readOnlyHint` and `idempotentHint` annotations no longer let a tool run without the owner's approval or mark it safe to replay; the hints still show on a connection's tool pages, and an owner who wants a tool to run unattended allows it by name as before. Two tools whose names differ only in characters the tool name can't carry, or beyond its 64 characters, no longer share one permission. A server whose tool list never ends is read for at most 50 pages and 500 tools. A conversation whose permissions record is missing asks for every tool instead of running them.
