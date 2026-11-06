# Routines

A user schedules a bot to run a prompt once, daily, weekly or on an interval. The editor previews the schedule in words and the next three run times (IST) before saving. A routine can be paused, resumed or run immediately. Each run is listed under `Recent runs` and shows in the bot's chat as one quiet line, not as a full exchange.

## Sub-features

- `routines-editor` picks a bot, name, prompt and schedule, with sentence + next-3-runs preview.
- `routines-card` shows a routine with `<bot> · <schedule>` and `Paused` when disabled.
- `routines-run-now` runs immediately and lists a `manual` run under `Recent runs`.
- `routines-chat-line` shows the run in the bot's chat as `data-testid=routine-runs`, without the prompt.
- `routines-toggle` pauses/resumes with the switch `Resume <name>` / `Pause <name>`.

## How to get to it (user POV)

- Sidebar button `Account and navigation` → menuitem `Routines` (`/routines`); also the ⌘K palette (`Search`). Header button `New routine`.
- From a bot's chat: a routine result line links to `/routines`.

## Driving it with ta-verify

Preconditions:

- Baseline run, doctor OK, signed in.
- Setup (API, not under test): a bot `Routine Bot <stamp>` with the default faux model.

- **Editor preview.** `New routine`; in the dialog, combobox `Bot` → option with the bot name (the listbox is portalled to page level); fill `Name`, `Prompt`; tab `Interval`; `Interval minutes` = `15`. Text `Every 15 minutes` and three `, HH:MM IST` times are visible before saving.
- **Cancel.** `Cancel` closes the dialog (saving would arm a real queued fire mid-run).
- **Paused card.** Setup: `POST /api/v1/routines` with `enabled: false`. Reload. The card (anchored on switch `Resume <name>`) shows `Routine Bot <stamp> · Every 15 minutes` and `Paused`.
- **Run now.** The card's `Run now`. Under `Recent runs` a list item with the name, `manual` and `succeeded` (or `awaiting`) appears; `GET /api/v1/routines/<id>/runs` returns `{ runs: [≥1] }`.
- **Chat line.** `/chats/<botId>`: `data-testid=routine-runs` with the name and a button containing `done`; no `**Routine "<name>"` text in the transcript.
- **Proof.** `ta-verify drive $S/journeys/routines.mjs` → `routines/editor-preview`, `routines/run-now`, `routines/chat-line`.

## Gotchas

- Every card has its own `Run now`, `Edit`, `Delete` and a `Paused` paragraph: always scope to one card, or a leftover routine makes the locator ambiguous.
- Times are always IST regardless of the browser's zone.
- Saving from the editor arms the routine through the job queue; a fire can race assertions. Create paused via the API when the editor isn't what's under test.
- The resume switch may surface a queue error toast in this environment instead of arming; that's environmental, not a routine bug.
