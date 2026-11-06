# Routine schedule

A routine saved in the editor runs by itself when its time comes: nobody presses `Run now` and nobody touches the job queue. The run is listed under `Recent runs` with the trigger `schedule`, and its result appears in the bot's chat as a quiet line, live if the chat is open. After a one-time routine has run, its card says `Done · edit to pick a new time` and its switch is off. The owner can also edit an existing routine and the changes stay after a reload, pause and resume it from the switch on its card, and delete it after confirming.

## Sub-features

- `routine-schedule-once` sets a `Once` slot through `Run at (IST)`. Before saving, the preview shows `Once, <day>, HH:MM IST` and one time. `Create` puts one `routine-fire` job in the queue for that instant, and the card shows `Next run … HH:MM IST`.
- `routine-schedule-fire`: the queue fires the slot on time and the run reaches `succeeded` with `trigger: "schedule"`, at the slot's exact `scheduledFor` and with output `Echo: …<prompt>`. Its job is `completed`, and the routine is now `enabled: false, done: true, nextRunAt: null`.
- `routine-schedule-chat-line`: `data-testid=routine-runs` with `<name> · done · HH:MM` arrives over the open chat's stream. Opening it shows the `routine-run` row (`data-status=succeeded`), which has the output but no `run now` mark, and a link `Open routines`.
- `routine-schedule-recent`: in `Recent runs`, a list item with the name, `succeeded`, the `schedule` badge (not `manual`) and the output.
- `routine-edit`: the card's `Edit` opens dialog `Edit routine` with the stored values. Changing the name, the prompt and the schedule (`Daily`, `Time (IST)` 07:45, preview `At 07:45` + three `07:45 IST` times) and pressing `Save` sends `PATCH /routines/<id>`, shows the toast `Routine saved` and re-arms one job for the new time.
- `routine-toggle`: switch `Pause <name>` / `Resume <name>` on the card. It sends `PATCH { enabled }`: pausing shows `Paused`, clears `nextRunAt` and cancels the queued job; resuming shows `Next run …` and arms one job.
- `routine-delete`: `Delete` opens alertdialog `Delete "<name>"?` (`permanently deleted`) → `Delete`, then the toast `Routine deleted`. The card is gone, `GET /routines/<id>` returns 404 and the queued job is cancelled.

## How to get to it (user POV)

- Open the sidebar menu `Account and navigation` → menuitem `Routines` (`/routines`) → `New routine`, or `Edit` / `Delete` / the switch on a card.
- The result appears in the bot's chat (`/chats/<botId>`) on its own, with no action needed.

## Driving it with ta-verify

Preconditions:

- A baseline run, doctor OK, signed in. Pushover must be `not_configured`; the journey checks this first, because a scheduled fire pushes `routine.succeeded`.
- Set up a bot `Sched Bot <stamp>` through the API (it is not what is under test).

- **Once, armed.** `New routine` → combobox `Bot` → the bot's option; `Prompt` `scheduled check <stamp>`; `Name` `verify-once-<stamp>`; tab `Once`; `Run at (IST)` = the next-but-one minute boundary in IST (60–120 s away). The preview reads `Once, … HH:MM IST`. `Create` → toast `Routine created`. The API shows `schedule: { kind: "once", at: "<YYYY-MM-DDTHH:mm>:00+05:30" }`, `nextRunAt` = the slot, and `GET /jobs?name=routine-fire` returns exactly one `created` job with `data.trigger: "schedule"` and `scheduledFor` = the slot.
- **Edit.** Setup through the API: a second routine `verify-edit-<stamp>`, enabled, every 60 minutes. `Edit`: the dialog shows `before the edit`, tab `Interval` selected, `60`. Set `Name` to `verify-edited-<stamp>`, set a new prompt, choose tab `Daily` → `Time (IST)` → `07:45`, then `Save`. The captured PATCH body has `{ botId, name, prompt, schedule: { kind: "cron", expr: "45 7 * * *" } }`. After a reload the card shows `<bot> · At 07:45` and `Next run … 07:45 IST`, the API shows the new values with `nextRunAt` at `02:15Z`, and one job is armed for that time. Reopening `Edit` shows the saved values (`Daily`, `07:45`).
- **Pause / resume.** Switch `Pause <name>` → the PATCH body is exactly `{ enabled: false }`; `Resume <name>` is unchecked, the card shows `Paused` (also after a reload), the API shows `enabled: false, nextRunAt: null`, and no `created` job is left. Switch `Resume <name>` → it is checked, `Next run …` is shown and one job is armed. Then, through the API only: `POST /routines/<id>/pause` and `/resume`, with the card read back after each reload.
- **Delete.** `Delete` → alertdialog → `Delete` → toast. The card is gone, the API returns 404 and no job is armed.
- **Scheduled fire.** Open `/chats/<botId>` before the slot (the line is absent), then wait for the `routine-runs` line with the name and `done`, for up to (time left until the slot) + 120 s. `GET /routines/<id>/runs` returns exactly `[schedule:succeeded]`. Reload, open the line: `data-status=succeeded`, the prompt is in the output, there is no `run now`, and there is no `Echo: **Routine` bubble. `/routines`: the `Recent runs` item has `succeeded` + `schedule` and no `manual`; the card shows `Done · edit to pick a new time` and its switch `Resume <name>` is disabled.
- **Proof.** `ta-verify drive $S/journeys/routine-schedule.mjs` → `routine-schedule/once-editor`, `once-armed`, `edit-dialog`, `edited`, `paused`, `deleted`, `chat-line-live`, `chat-line-open`, `recent-runs`.

## Gotchas

- The editor allows intervals of 15 minutes or more, and `Once` has minute resolution. A one-time slot 1–2 minutes ahead is the quickest scheduled fire the editor can create; the drive spends about 80–100 s waiting for it.
- The card's switch sends `PATCH /routines/<id> { enabled }`, not `POST /pause|/resume`. The page uses `POST /resume` only through the `Resume` button, which appears only on a routine the app paused itself (`pausedReason`, after 3 blocked runs or a failed submit). The faux model cannot block a run, so that button is not driven, and the two endpoints are exercised through the API only.
- Upcoming slots and run rows also mention the routine's name. Scope assertions to one card (anchored on its switch), or filter list items by name plus `succeeded`.
- A fired job stays as a `completed` row in `/jobs` after the routine is deleted. The journey's last cleanup deletes the `routine-fire` jobs of its own routines.
- With the faux model the run only echoes the labelled prompt. Anything a real model would do inside a routine (tools, vault, refusals as unattended) needs a real provider.
