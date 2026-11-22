---
"tiny-agents": minor
"@tiny-agents/agent": minor
"@tiny-agents/code": minor
"@tiny-agents/models": minor
"@tiny-agents/sandbox": minor
---

Code has a third agent, Native, built on the same runtime the chat bots use. It needs a sandbox and a model that runs on pi, and no other setup. A Native thread reads, writes and edits files and runs commands in its working directory on the sandbox, asks before it changes anything unless its permission mode says otherwise, takes a steer or a queued message while it works, and can be stopped, forked, compacted and continued after an error. Settings → Models has a new default, New Code threads, for the model a Native thread starts on.

For developers: `AgentRuntime` gains `cwd` on a conversation's config, `fork`, `compact` and `continueReply`; `@tiny-agents/agent` exports `createCodingToolkit` and `codingSelection`; `@tiny-agents/code/server` exports `createPiHarness` and its `PiPort`; the model catalog has a `code_default` role; and a sandbox `exec` takes an abort `signal`.
