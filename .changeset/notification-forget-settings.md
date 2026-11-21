---
"@groot/core": patch
---

`NotificationService.forgetSettings()` and `NotificationHub.forgetSettings()` drop the cached notification settings, so the next read loads them from the store. The server test setup calls it after every file, because each file gets its own database.
