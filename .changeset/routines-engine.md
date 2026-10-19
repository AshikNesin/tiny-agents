---
"@groot/web": minor
"@groot/jobs": patch
---

Routines engine (issue #18 phase A): schedule any bot to run a prompt on a once/cron/interval schedule in IST. New Routine/RoutineRun tables (both engines, unique (routineId, scheduledFor) as the exactly-once ledger), a pure schedule module (next occurrence via cron-parser in Asia/Kolkata, grace clamp, cronstrue sentences, IST wall-clock labels), a fast LLM-free `routine-fire` job that submits the labeled prompt into the bot's durable conversation with a stable requestId and chains the next delayed job, an activity-feed completion watcher that resolves awaiting runs with a reply preview plus a boot sweep for restarts, and a JWT-protected REST API under /api/v1/routines (CRUD, pause/resume, run now, run history).

Also fixes a latent bug in the pg-boss queue adapter: `delaySeconds` was silently dropped (pg-boss v12 has no such option), so every delayed Postgres job ran immediately; it now maps onto `startAfter`.
