---
"tiny-agents": patch
"@tiny-agents/agent": patch
"@tiny-agents/code": patch
---

No hardcoded Claude models: the Claude plan and the Code page use only what Claude Code lists for your subscription.

- **Settings:** a new Claude plan account connects with no models until Claude Code is signed in. "Check again" adds each model Claude Code lists, so a new model appears without adding it by hand. The `opus` / `sonnet` / `haiku` fallback is gone.
- **Code page:** the Claude Code picker offers the Claude plan account's models (full ids, versioned names) instead of a fixed Opus / Sonnet / Haiku list. With none saved, it shows what Claude Code's sessions report.
