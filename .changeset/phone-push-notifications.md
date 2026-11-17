---
"tiny-agents": minor
"@groot/core": minor
"@tiny-agents/agent": patch
---

Phone notifications over Web Push (issue #306), with no setup on the server.

- **A Web Push channel beside Pushover.** The server makes its own VAPID key on first use and sends each registered device an end-to-end encrypted push (RFC 8291, RFC 8292) through Google's FCM on phones with Play services. No Firebase account, relay or env var.
- **Devices.** `GET /notifications/vapid-key` and `/notifications/devices` (register, list, test, remove; owner only). Endpoints must be https and public. A device the push service forgot is revoked; one that keeps failing shows as failing.
- **Approve from the notification.** Approval pushes carry the chat card's buttons for the app to show: Approve, Deny and Always allow for a tool, Approve, Deny and For this chat (when grantable) for a vault use.
- **Taken back when answered.** Answering an approval or question anywhere takes its push off the phone; a reminder replaces the first push instead of stacking.
- **Settings → Notifications** lists the phones with a test and remove each, and a switch for the whole channel.
- `@groot/core`: `NotificationHub` fans each notification out to every channel, each with its own pipeline and log row; channels get the tag, event, path and buttons of what they send and an optional `dismiss(tag)`.
