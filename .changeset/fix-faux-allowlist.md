---
"@tiny-agents/agent": patch
---

Allow AgentRuntime.open to take an env snapshot (options.env). The faux/E2E boot uses it to clear GATEWAY_MODEL_ALLOWLIST, which otherwise filters the faux test model out of /models and breaks e2e bot creation on machines whose .env sets the allowlist.
