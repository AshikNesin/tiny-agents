---
"@tiny-agents/agent": patch
---

`GateCall.run` is required. An engine that leaves it out no longer compiles, instead of silently skipping the 150-tool-calls-per-reply cap the way the Claude Code engine did before its fix.
