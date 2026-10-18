---
"@tiny-agents/agent": minor
---

First-class capabilities per bot (issue #1): approvals, skills, toolkits and remote MCP.

- **Capabilities:** `AgentRuntime.open` gains `capabilities` — a toolkit, the bot's skills or an MCP connection, each a pi-durable extension behind the approval gate, selected per conversation by `configure({ capabilities })`. `Allow · Ask · Off` per tool (`BotAgentConfig.capabilities`), with read-only tools defaulting to allow. `installCapability`/`uninstallCapability` hot-swap connections; `listCapabilities` describes them for the UI.
- **Approvals:** an `ask` tool waits on a task-scoped approval document (`api.watchDoc`) and re-attaches after a restart; `decideApproval`/`pendingApprovals` answer and count them; the side effect of an unsafe tool never runs twice across a crash (memo-guarded). Chat events carry `ActivityChange.approvals`.
- **Tool UI data:** `ChatMessage.toolCalls` now carry id, args, status (running/awaiting*approval/done/error/denied/interrupted/aborted), output, duration, sources (web tools) — built from `pi.tool-result` entries and live `tool_execution*\*` events.
- **Toolkits:** `tasks` (moved to `toolkits/tasks`), `web` (Cloudflare Web Search API + Browser Rendering `/markdown`, SSRF-guarded, `CLOUDFLARE_API_BASE_URL` front door supported) and `time`.
- **Skills:** the `skills` capability lists a bot's skills in a stable prompt section and serves `load_skill`/`read_skill_file`; `save_skill` is ask-only. `SKILL_NAME` validates Agent Skills naming.
- **MCP:** `connectMcp` (Streamable HTTP with SSE fallback, `list_changed`, OAuth via `OAuthClientProvider`) and `createMcpCapability` (`mcp:<slug>`, tools `mcp__<slug>__<tool>`, replay from annotations). Depends on `@modelcontextprotocol/sdk` 1.29.0.

App side (not a published package): Bot gains `toolkits`/`toolPermissions` (existing bots keep `tasks` via migration), Skill/BotSkill and Connection/BotConnection tables, `/api/v1/capabilities`, `/skills`, `/connections` (test, reconnect, authorize, OAuth callback, client metadata document), `POST /bots/:id/approvals/:taskId` with `alwaysAllow`, `SECRETS_KEY` (AES-256-GCM at-rest secrets) and a ConnectionManager that connects at boot without blocking readiness.
