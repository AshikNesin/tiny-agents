# Notifications

Settings → Notifications has one `Send notifications to` choice (`Phone app`, `Pushover`, `Off`; never two at once) and shows only the chosen channel's details: for Pushover, whether it is connected (here: `Not configured`, naming the two env vars to set), lets the owner choose which events push, set quiet hours, timing and a device, and lists recent notifications. Inside the app, a bot waiting on the owner is signalled everywhere: the sidebar row says `1 question for you`, the tab title gains a `(1)` count and the favicon gets a badge, all clearing once answered.

## Sub-features

- `notify-off-state` shows badge `Not configured`, names `PUSHOVER_API_TOKEN` and `PUSHOVER_USER_KEY`, and hides `Send test` / `Re-check Pushover`. With no phone registered, `Pushover` is the checked radio.
- `notify-phone-chosen`: choosing `Off` says `Nothing is sent. Bots work the same.` and hides `What to send`; choosing `Phone app` shows `No phones yet` and no Pushover env vars; each saves `deliverTo` (`off`, `webpush`).
- `notify-events` groups event switches (`Needs you`, `Updates`, `Security`, `System`); `Vault alerts` is locked on.
- `notify-preferences` saves an event switch, quiet hours (`From`, `Until`, time zone), timing (`Long reply (minutes)`, `Reminder (minutes)`, `Grouping window (seconds)`) and `Pushover device (optional)` (shown only with Pushover chosen); toast `Notification settings saved`; persists across reload.
- `notify-log` shows `Nothing sent yet.` while Pushover is off.
- `attention-waiting` marks a bot waiting on a question: sidebar label, `(1) <page> · tiny-agents` title on every page, badged favicon.
- `attention-cleared` removes all three once the questions are answered.

## How to get to it (user POV)

- Account menu (`Account and navigation`) → `Settings` → `Notifications` (`/settings/notifications`).
- The attention signals appear on their own while any bot waits on an approval or a question.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK (doctor fails unless push notifications are `not_configured`), signed in. The journey saves the original settings and restores them (`PUT /api/v1/notifications/settings`) in cleanup.

- **Off state.** `/settings/notifications`: heading `Notifications`, radio `Pushover` checked, text `Not configured`, both env var names; no `Send test` or `Re-check Pushover`. `GET /api/v1/notifications/status` → `state: "not_configured"`.
- **Events.** Regions `Needs you`, `Updates`, `Security`; checkbox `Vault alerts` checked and disabled; `Nothing sent yet.`.
- **Save.** Uncheck `Long reply finished`; check `Hold updates during quiet hours`; `From` 22:30, `Until` 07:15; `Long reply (minutes)` 12; `Pushover device (optional)` `verify-device-<stamp>`; `Save`. Toast `Notification settings saved`.
- **Persist.** Reload: every value is back; `GET /api/v1/notifications/settings` has `events["run.long_done"] = false`, the quiet hours, `longRunMinutes: 12`, the device.
- **Waiting.** Setup (API): a faux bot. `/chats/<bot>`: title `<bot> · tiny-agents`, favicon `/favicon.svg`. Send `/ask set up the project`: `question-card` test id, label `1 question for you`, title `(1) <bot> · tiny-agents`, favicon not `/favicon.svg`; after clicking `Tasks` the title is `(1) Tasks · tiny-agents`. `GET /api/v1/notifications/log` has no `question.asked` row.
- **Cleared.** Back in the chat, answer the card (radio `React`, checkbox `Auth`, `Next`, textbox `Anything else I should know?`, `Send answers`): card gone, title without count, label gone, favicon `/favicon.svg`.
- **Proof.** `ta-verify drive $S/journeys/notifications.mjs` → `notifications/off-state`, `notifications/saved`, `notifications/attention-waiting`, `notifications/attention-cleared`.

## Gotchas

- Unreachable here: a real push, `Connected` (devices, monthly quota), `Send test`, `Re-check Pushover`, a registered phone, delivery/log rows, quiet-hours digests, reminders and coalescing. They need `PUSHOVER_API_TOKEN` + `PUSHOVER_USER_KEY` and pushover.net; a verify run must never have them (they reach real phones). The harness blanks them and doctor checks `not_configured`.
- The favicon href is the only non-ARIA handle (`link[rel="icon"]`), read with `page.evaluate`.
- `/ask` is a faux-model command: the bot asks three sample questions (single choice, multiple choice, open).
