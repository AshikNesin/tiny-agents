---
"tiny-agents": patch
---

"Always allow" on an approval card now switches on only the tool of the call being approved: a request naming another tool is refused (400 `ALWAYS_ALLOW_MISMATCH`), a vault use can't be always allowed, and nothing changes when no such call is waiting.
