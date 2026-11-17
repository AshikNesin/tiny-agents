---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

A reply that hit a run limit now says so. A tool call the gate refused for the token budget or the 150-call cap is marked on its row (`limit`), and the turn's Finished reply carries `stoppedBy`. A routine run stopped by the tool-call cap is recorded as blocked with the reason, instead of succeeding on partial output, and a bot-to-bot message that hit a limit before saying anything tells the asking bot which limit, instead of "(no reply)".
