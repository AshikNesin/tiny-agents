---
"tiny-agents": minor
---

Bots tidy their memory once a week. One small model call per bot (only when its memories changed) merges duplicate memories and expires ones that a newer memory contradicts or whose time has passed. Changes show on the Memory page as superseded or expired and can be restored, and a plan that would touch more than half the memories is ignored.
