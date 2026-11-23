---
"@groot/core": patch
"@tiny-agents/agent": patch
"@tiny-agents/claude-worker": patch
---

Security fixes from the audit. A routine's webhook URL token is no longer written to request logs, error reports or Sentry: hook paths log as `/api/v1/routines/hooks/[redacted]` on every outcome, including 404s and oversized deliveries. A tool that throws on the Claude plan engine has its error scrubbed of registered vault secrets before the model reads it. The auto-review classifier state scrubs first and clips after, so a secret straddling the clip limit no longer reaches the classifier. The Claude worker no longer passes its own `CLAUDE_WORKER_TOKEN` or `CLAUDE_WORKER_PORT` into the Claude Code subprocess environment, or into its git subprocesses; the worker keeps its token for authenticating the app's connection.
