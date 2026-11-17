---
"tiny-agents": minor
"@groot/core": minor
"@groot/shell": minor
---

Notifications go to one place at a time.

- **One choice.** A new `deliverTo` setting (`webpush` for the phone app, `pushover`, `off`, or `auto`) replaces the per-channel `channels` switches. Only the chosen channel sends; `auto`, the default, is the phone app once a phone is registered, else Pushover.
- **A simpler Settings → Notifications.** One "Phone app / Pushover / Off" picker shows only the chosen channel's details (its phones, or Pushover's status and test), then what to send and the log. `NotificationSettings` takes the app's extra `destinations`.
