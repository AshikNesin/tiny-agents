---
"@groot/web": minor
"@groot/jobs": patch
"@tiny-agents/agent": minor
---

Routines (issue #18): schedule any bot to run a prompt on a once/cron/interval schedule in IST.

Engine (phase A): Routine/RoutineRun tables (both engines, unique (routineId, scheduledFor) as the exactly-once ledger), a pure schedule module (next occurrence via cron-parser in Asia/Kolkata, grace clamp, cronstrue sentences, IST wall-clock labels), a fast LLM-free `routine-fire` job that submits the labeled prompt into the bot's durable conversation with a stable requestId and chains the next delayed job, an activity-feed completion watcher that resolves awaiting runs with a reply preview plus a boot sweep for restarts, and a JWT-protected REST API under /api/v1/routines (CRUD, pause/resume, run now, run history).

UI (phase B): a Routines page with upcoming runs, schedule cards (enable toggle, run now, edit, delete), and recent executions with status chips, durations, and manual/schedule trigger badges. The editor dialog picks a bot and compiles Once / Daily / Weekly / Interval / Custom cron presets into the schedule union (once carries an explicit +05:30 IST offset), showing the plain-English sentence and the next 3 fire times in IST before saving.

Chat toolkit (phase C): a `routines` toolkit on the agent package, per-bot enable like tasks/web, so the owner can set up a routine in chat. `create_routine(name, prompt, schedule)` validates the union exactly like the API and answers with a confirmation card (the cronstrue sentence plus the next 3 fire times in IST); `list_routines` shows each routine's sentence, next run, and paused marker; `update_routine` and `delete_routine` are partial and replay-safe (durable memo delete report); `run_routine_now` fires a manual occurrence. `list_routines` defaults to allow, the mutating tools to ask. Routine.sourceKey (nullable unique, both engines, same pattern as Task.sourceKey) makes creates exactly-once across pi-durable replays, and the app-side store adapter rejects routine management from routine-fired turns (the recursion guard) while list stays open.

Also fixes a latent bug in the pg-boss queue adapter: `delaySeconds` was silently dropped (pg-boss v12 has no such option), so every delayed Postgres job ran immediately; it now maps onto `startAfter`.
