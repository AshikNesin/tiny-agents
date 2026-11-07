---
"@groot/core": patch
"@groot/jobs": patch
"tiny-agents": patch
---

Comments in `@groot/core` (env, bootstrap, storage adapter), the `@groot/jobs` "no job handlers registered" log line and the setup script's deploy hint no longer describe the deleted Workers target, `@groot/ai` or a `startWebApp()` that does not exist.
