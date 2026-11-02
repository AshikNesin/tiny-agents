---
"@tiny-agents/agent": minor
"@tiny-agents/claude-worker": minor
---

Experimental Claude Pro/Max inference. Bots can select `claude-code/<model>`
("uses your Claude plan"). Turns go to a loopback worker that drives the
official Claude Agent SDK. tiny-agents does not read, store, or refresh the
Claude login, does not set `ANTHROPIC_BASE_URL`, and refuses to boot when
model-provider config contains an `sk-ant-oat` token. `CLAUDE_CODE_ENGINE_ENABLED`
is the kill switch. Default fallback is pause.
