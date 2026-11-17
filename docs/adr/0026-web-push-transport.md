# 0026 — Web Push is the push transport; the server holds no provider credentials

- Status: accepted
- Date: 2026-11-17
- Design: issue #306

## Context

The Android app needs native notifications, including Approve and Deny
buttons on approvals. tiny-agents is self-hosted: every owner runs their own
server, and most use the published APK. Calling FCM directly needs the
service-account key of the Firebase project that owns the app id, which
can't be handed to every server. Pushover needs a paid app and two env vars,
can't take a notification back, and its links open the app only for the one
host built into the APK.

## Decision

- **The server speaks Web Push only** (RFC 8030 delivery, RFC 8291 payload
  encryption, RFC 8292 VAPID). Its contract with a device is an endpoint URL
  plus `p256dh` and `auth`. It makes its own VAPID key on first use, sealed
  with `SECRETS_KEY` when one is set.
- **The app receives through UnifiedPush** with the embedded FCM distributor:
  on a phone with Google Play services, FCM's Web Push endpoint delivers; on
  one without, a distributor such as ntfy (self-hosted if the owner likes).
  The Firebase project for `io.nesin.tinyagents` belongs to the app, not to
  any server.
- **Every channel runs its own pipeline** under one `NotificationHub`:
  Pushover stays as an optional, parallel channel with its own switch.
- **The payload is data the app renders**: a tag to replace or take back the
  notification, the event, the app path, and an approval's buttons. Answering
  anywhere sends a `dismiss` under the same `Topic`.
- **Buttons answer through the existing approval route** with the app's
  session. Android asks for the device to be unlocked before running one.

## Consequences

- A self-hoster sets nothing up for phone notifications.
- Push services see ciphertext, its size, urgency and TTL only.
- If Google's Web Push path for FCM stops working, an author-run relay that
  exposes a Web Push endpoint can replace it with a change to the app alone;
  servers keep working unchanged.
- The release-hub APK carries the proprietary Firebase library. A FOSS build
  would drop the embedded distributor and rely on ntfy.
- Changing `SECRETS_KEY` without rotating makes a new VAPID key and revokes
  every device; the app registers again when it next sees the key changed.

## Alternatives considered

- **FCM HTTP v1 from the server.** Needs the app owner's service-account key
  on every server.
- **A per-owner Firebase project and APK build.** Far too much setup.
- **A push relay run by the app author.** Works, but means running
  infrastructure forever and a relay that sees metadata. Kept as the plan if
  Google's path breaks.
- **A persistent connection from the app.** A permanent notification, battery
  drain, and phone makers kill it.
