# Push Notifications

When a bot needs the owner (an approval, a question) or unattended work ends
(a routine, a failed or long reply), the owner gets a push on their phone with
a link straight to where they answer. Two channels deliver, each optional and
each with its own switch:

- **Phone app** (Web Push, issue #306): the Android app registers itself after
  sign-in. Nothing to set up on the server. Approvals carry buttons.
- **Pushover** (issue #57): two env vars and the paid Pushover app.

## Phone app (Web Push)

The server makes a VAPID key pair on first use (KV `WEB_PUSH:vapid`, the
private key sealed with `SECRETS_KEY` when it is set) and sends each
registered device an end-to-end encrypted push (RFC 8291 `aes128gcm`, RFC 8292
VAPID) to the endpoint its push service gave it: FCM on phones with Google
Play services (the app's default), ntfy or another UnifiedPush server when the
phone has none or the owner picks one in the app's Settings. A self-hosted ntfy
with `auth-default-access: deny-all` must let anyone write `up*` topics
(`ntfy access everyone 'up*' write-only`), or it answers 403: ntfy ignores the
VAPID `Authorization` header. The server needs no Firebase account, relay or env var ([ADR 0026](../adr/0026-web-push-transport.md)).
Push services see ciphertext, its size, urgency and TTL.

- **Payload.** JSON the app renders: `{ v: 1, kind: "show", id, tag, event,
  category, title, message, path, priority, actions? }`, or `{ v: 1, kind:
  "dismiss", tag }`. Priority becomes `Urgency` (1 `high`, 0 `normal`, -1
  `low`, -2 `very-low`), `ttlSeconds` becomes `TTL` (default 24 h), and the
  tag becomes `Topic`, so a dismiss replaces a show the push service still
  holds.
- **Buttons.** An approval's push carries the chat card's answers in
  `actions` (`kind`, `botId`, `taskId`, `tool`, `grantable`): a tool approval
  offers **Approve**, **Deny** and **Always allow**; a vault approval offers
  **Approve**, **Deny** and, when the use is grantable, **For this chat**.
  The app answers through `POST /bots/:id/approvals/:taskId`, after the phone
  is unlocked. Questions, takeovers and sign-in requests have no buttons.
  A coalesced summary has none either.
- **Taken back.** Answering an approval or question anywhere sends a dismiss
  for its tag. A reminder shares its request's tag, so it replaces the first
  push. A summary of several requests stays until opened.
- **Devices.** Settings → Notifications → **Phone app** lists them, with
  **Send test** and remove each, and **Send notifications to phones** turns
  the channel off (`channels.webpush: false`).

| Push service answer        | What happens                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| 2xx                        | Delivered; the device's failure count resets                          |
| 404, 410                   | The device is `revoked` and no longer sent to                         |
| 429, 5xx, network, timeout | Retried like Pushover; five failures in a row mark the device failing |
| Other 4xx                  | Not retried                                                           |

A push counts as sent when any device took it. Endpoints must be `https` and,
unless `PUSH_ALLOW_PRIVATE_ENDPOINTS=true` (ntfy on a LAN or tailnet), resolve
to public addresses. An account registers at most 10 devices. Changing
`SECRETS_KEY` without rotating makes a new key and revokes every device; the
app registers again.

## Pushover setup

Set two env vars in the server environment (Coolify) and restart:

| Var                  | Pushover's name | Where to find it                                                  |
| -------------------- | --------------- | ----------------------------------------------------------------- |
| `PUSHOVER_API_TOKEN` | `token`         | The application you register at <https://pushover.net/apps/build> |
| `PUSHOVER_USER_KEY`  | `user`          | Your user key on the pushover.net dashboard (or a group key)      |

`ORIGIN` (already required in production) is the base of every deep link; with
it unset, notifications carry no link.

Without both vars the feature is off: nothing is logged or sent, and
**Settings → Notifications** says what to set. With them, boot checks the
credentials (`users/validate.json`) and Settings shows **Connected**, the
device names and the month's remaining quota. **Send test notification**
sends one at once and shows Pushover's request id; **Re-check** validates
again.

## Events

| Event                  | When                                                                                                                       | Priority    | Opens                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------- |
| `approval.requested`   | A tool that asks first waits for approval                                                                                  | 1 (high)    | `/chats/:botId?focus=approval:<task>` |
| `question.asked`       | `ask_owner` waits for answers (preview: the first question)                                                                | 1           | `/chats/:botId?focus=question:<task>` |
| `credential.requested` | A bot asked for a login it doesn't have (`request_credentials`); vanishes when the request expires                         | 1           | `/vault/requests/<task>`              |
| `input.reminder`       | Still waiting after `reminderMinutes` (15); one reminder per call                                                          | 1           | same as above                         |
| `routine.succeeded`    | A routine run finished (preview of the reply; ttl 24 h)                                                                    | -1 (quiet)  | `/routines`                           |
| `routine.failed`       | A run failed, was missed, was interrupted, or its routine paused                                                           | 0           | `/routines` (paused: the chat)        |
| `run.failed`           | A reply ended in a model error while nobody had the chat open                                                              | 0           | `/chats/:botId`                       |
| `run.long_done`        | A reply that ran ≥ `longRunMinutes` (5) ended while nobody watched                                                         | -1          | `/chats/:botId`                       |
| `system.started`       | The production server booted                                                                                               | -2 (silent) | `/`                                   |
| `vault.alert`          | A vault value was revealed or an item deleted in the Vault UI, or a fill was refused for its target (cannot be turned off) | 1           | `/vault`                              |

Each can be turned off in Settings. "Nobody watched" means no open chat
stream for that bot (`bots.viewers.ts`); approvals and questions always send,
since the owner may be on another tab. A routine's run happens in the
routine's own conversation and reports through the routine events only; it
never waits on the owner (see [routines](./routines.md)). The `?focus=` link scrolls the chat to the waiting
card (`focus-param.ts`). On an Android phone with the app, the same link opens
the app on that card ([mobile app](./mobile-app.md), "Links from
notifications").

## Content rules

- Titles are ≤ 80 chars and messages ≤ 300, plain text (never `html=1`), with
  control characters stripped.
- An approval names the bot and the **tool** only, never its arguments. A
  vault approval also names the item and the target's host (the phishing
  tell), and a credential request its title and host. Values never leave.
  Nothing ever includes tool output, field values or headers.
- Free text (question previews, routine output, error reasons) goes through
  `scrubText` (`packages/core/src/notification/scrub.ts`): links become
  `[link]`, registered redactors run (the vault's `secretRedactor` is
  registered at boot, so values the vault resolved never leave),
  secret-looking runs (bearer tokens, `sk-…`, long hex/base64, 30-char keys)
  become `[redacted]`, and a field the scrubber had to rewrite by more than
  20% is dropped. Then it is cut to 200 chars.
- Every message is built by a typed template in
  `apps/web/src/server/api/notifications/notifications.events.ts`.
- The log stores the title and path only, never the message.

## Settings

One `notifications` app setting (zod-validated, defaults filled in):

- **Per-event switches.** Events marked `locked` (future security alerts)
  cannot be turned off.
- **Quiet hours** (off by default; times in `Asia/Kolkata` unless changed).
  Updates (`notify`) are held and sent as one digest when quiet hours end,
  or dropped if their ttl passed. Requests for input still send, at priority
  -1, unless "requests still make a sound" is on.
- **Timing.**
  - `longRunMinutes` (5).
  - `reminderMinutes` (15; 0 turns reminders off).
  - `coalesceSeconds` (30): approvals and questions from one chat within the
    window send as one ("Ops bot needs you · 2 approvals and 1 question
    waiting").
- **Device:** deliver to one Pushover device only.
- **Channels:** `channels.<id>: false` turns a channel off (`pushover`,
  `webpush`).
- **Throttle:** at most 30 an hour and 5 a minute per bot. Beyond that,
  pushes are logged as `suppressed: throttled` and one "N notifications
  suppressed" goes out when the window ends.

## Delivery

```
emit points (apps/web: runtime.onWait, the settled pipeline, routine runs/jobs, boot)
  → notificationService.notify(n)    NotificationHub    [packages/core/src/notification]
  → per channel: switch → dedupe → channel state → quiet hours → coalesce → throttle
  → delivery queue (≤ 2 concurrent) → PushoverChannel | WebPushChannel → NotificationLog
```

Each channel has its own pipeline, dedupe and log row (`channel` column).

- **`notify()` is fire-and-forget.** It returns at once and never throws, so
  tool calls and approval waits never wait on Pushover.
- **Dedupe.** A dedupe key (`approval:<conversation>:<task>`,
  `routine:<runId>:<status>`, …) sends once per 24 hours. The log backs the
  check, so a waiting call that re-runs after a restart (and re-registers its
  wait) does not push again.
- **Cancel on resolve.** Answering an approval or question drops its push if
  it is still coalescing or queued, cancels its reminder, and takes a sent
  push back from phones (Pushover can't).
- **Response handling:**

  | Pushover response          | What happens                                                                                 |
  | -------------------------- | -------------------------------------------------------------------------------------------- |
  | 200 + `status:1`           | Logged `sent` with the request id                                                            |
  | 429                        | Over quota: no retry; nothing is sent until the reset (the 1st, 00:00 US Central)            |
  | Other 4xx                  | Never retried. A bad token or user key marks the channel invalid until Re-check or a restart |
  | 5xx, network, 10 s timeout | Retried after 5 s, 30 s, 2 min and 10 min (±20% jitter)                                      |

  When the monthly quota drops below 10%, one warning push goes out.

- **Delivery is in-process.** A restart drops queued sends. Pending approvals
  and questions are re-derived on boot.
- **Log rows** live in `notification_log`. Rows older than 30 days are
  pruned daily.

## API

All routes are behind the session (JWT), under `/api/v1/notifications`.

| Route                    | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `GET /status`            | Channel state, devices, quota, last error, the env vars it needs |
| `GET /settings`, `PUT …` | The owner's settings plus the event list (400 on invalid input)  |
| `POST /test`             | Send a test now (1 per 10 s); `{ ok, providerId }` or the reason |
| `POST /validate`         | Re-run `users/validate.json` and refresh the quota               |
| `GET /log?limit=50`      | Recent rows (metadata only)                                      |

The phone app's devices (owner only; guests get 403):

| Route                    | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `GET /vapid-key`         | `{ publicKey }` the device registers with              |
| `POST /devices`          | Register or refresh by endpoint; returns `{ id }`      |
| `GET /devices`           | The account's devices (no keys or endpoint paths)      |
| `DELETE /devices/:id`    | Remove one                                             |
| `POST /devices/:id/test` | Send a test now; `{ ok }` or the push service's answer |

## Not yet

These are not built yet:

- Emergency priority (2) with receipts.
- Per-bot mute.
- `job.failed` and `peer.reply`.
- Browser Web Push for the web app (the same channel; needs a service worker).
- Other channels (Telegram).
- A model-facing `notify_owner` tool. It is left out on purpose, so prompt
  injection cannot push.
- Durable (job-queue) delivery.
