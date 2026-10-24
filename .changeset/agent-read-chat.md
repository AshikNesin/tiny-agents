---
"@tiny-agents/agent": patch
---

`AgentRuntime.readChat(ref)` reads a conversation's chat state once (the snapshot `watchChat` delivers first) for one-shot readers such as the relay, the routines watcher and memory capture, replacing the watch-then-stop idiom at those call sites. The bot-to-bot relay now runs for the conversation that went idle instead of sweeping every bot with pending deliveries on each idle; the boot sweep is unchanged.
