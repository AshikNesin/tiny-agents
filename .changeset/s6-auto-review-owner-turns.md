---
"@tiny-agents/agent": patch
"tiny-agents": patch
---

Auto-review no longer counts a guest's messages as the owner's (security fix, S6). In a shared bot's chat a turn a guest started always shows its approval card, and the classifier reads only the owner's own messages, the same rule YOLO mode applies (`fromOwner` in `policy.ts`). `ToolGate` and `AgentRuntime.open` take an `ownerUserId` option for this; without one, no message with an author counts as the owner's. `ownerMessages()` now takes the owner's user id as its second argument.
