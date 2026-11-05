---
"@tiny-agents/agent": minor
---

One Tool gate for both bot engines (ADR 0014). A Claude plan tool call now
goes through the same gate as a pi one: it is counted while it waits for your
approval (the Bot list badge, push notifications), its result is scrubbed of
vault values, auto-review can approve it, and vault cards and refusals from
gate plans apply. YOLO mode reads one document for both engines, so a vault
tool called without a vault item runs under YOLO on the Claude plan too, and a
denied call shows as denied. Inside the package, `AgentEngine` is now a real
per-conversation interface: `PiEngine` owns the pi-specific code and
`AgentRuntime` only picks the engine (including the gateway fallback latch),
holds the store and merges activity.
