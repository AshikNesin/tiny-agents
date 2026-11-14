---
"tiny-agents": patch
"@tiny-agents/agent": minor
"@tiny-agents/claude-worker": patch
---

Claude plan: the transcript lives in the agent store, and sends behave as they do on pi (ADR 0018).

- **Durable transcript:** each message and reply is an entry of the bot's own conversation in `agent.db`, not a JSON file beside it. On the first start after the upgrade, `<agent.db>.claude.json` is imported once and renamed `.claude.json.imported`; a file that cannot be read is left as it is and logged.
- **Sends:** a send returns as soon as it is stored instead of when the reply ends, a retried send is not added twice, and a message sent while Claude replies waits above the composer (withdraw it there) and is answered next.
- **Stop and pauses:** a stopped reply stays stopped, Stop also ends the Claude Code process on the sandbox, a usage pause keeps your message and frees the worker for the next turn, and a reply with nothing in it still counts as finished.
- **Restarts:** after an app restart a Claude plan chat shows its own transcript right away.
- **Long waits:** a tool call waiting for your approval, answer or sign-in no longer times out after two minutes on the worker.
