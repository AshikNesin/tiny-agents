---
"tiny-agents": patch
"@tiny-agents/agent": patch
"@tiny-agents/claude-worker": patch
---

Claude plan: raise the per-reply turn limit and make it a setting.

- **Default:** Claude Code's `maxTurns` goes from 30 to 100, so browser tasks no longer stop with "Reached maximum number of turns (30)".
- **Settings → Models → Claude plan → Max turns:** set 1 to 1,000, or tick **No limit** (opt-in) to run Claude Code without `maxTurns`. It applies from the next message, with no release: the worker restarts an idle Claude process with the new limit and resumes the conversation.
- **Error:** running out of turns now says where to raise the limit.
