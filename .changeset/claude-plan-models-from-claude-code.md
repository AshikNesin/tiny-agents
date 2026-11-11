---
"tiny-agents": patch
"@tiny-agents/agent": patch
"@tiny-agents/claude-worker": patch
---

The Claude plan lists its models from Claude Code instead of a hardcoded list.

- **Worker:** a new `models` request asks the signed-in Claude Code for its model list (the Agent SDK's `initializationResult().models`) without sending a prompt.
- **Discovery:** each model is saved under the id its alias resolves to (`claude-opus-5-5`) and named from pi-ai's catalog. A new account starts on the `opus`, `sonnet` and `haiku` aliases until Claude Code is signed in.
- **Settings:** the Claude plan card can check again and add the models Claude Code lists.
