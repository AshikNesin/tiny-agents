---
"@tiny-agents/agent": minor
---

Add task tools: a pi-durable "tasks" extension (create/list/update/complete/delete_task) that lets bots manage the app's task list from chat, replay-safe with callId-keyed exactly-once creates. AgentRuntime.open gains an `extensions` option; testing.ts gains `respondWith` (faux tool-call replies) and re-exports `fauxToolCall`.

Also: container-env tolerance for the gateway URL builders. Coolify and
docker-compose editors keep literal quotes around values
('"https://…"', '"[{…}]"'); those now unquote instead of producing
"Invalid URL" at send time, GATEWAY_BASE_URL validates as a URL (falls
back to the real gateway host with a boot warning), a bad custom-provider
prefix is skipped with a warning instead of crashing mid-chat, and
GATEWAY_CUSTOM_PROVIDERS/GATEWAY_MODEL_ALLOWLIST tolerate quote wrapping.
createGatewayModels(env) accepts an explicit env; AgentRuntime passes its
snapshot.
