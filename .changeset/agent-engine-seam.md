---
"@tiny-agents/agent": patch
---

`AgentRuntime`: the Claude plan's account calls move to `runtime.claudePlan` (rewrite step 2.5, no behavior change).

- **Moved:** `claudeCodeStatus()` is now `claudePlan.status()`, `claudeCodeAccount()` is `claudePlan.account()`, and `prepareClaudeCode()` is `claudePlan.prepare()`. They return what they returned before.
- **Inside the package:** the runtime calls engines only through `AgentEngine`. What every conversation has whichever engine runs it (create, configure's agent and permissions, YOLO, attachment ids, the reply-task graph) is the runtime's conversation store.
