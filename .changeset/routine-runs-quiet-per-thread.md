---
"@groot/web": patch
---

Routine results in the chat are quiet and per thread (issue #63 follow-up).

- A finished run shows as one centered line (name, status, time) instead of a full card; runs that finish back to back fold into one line ("ran 4× · 1 failed · last 09:00"), and clicking it shows each run's output and error.
- `Bot.chatStartedAt` (both engines, migration `bot_chat_started_at`): set when a bot is created and on "New chat". Only runs that finished after it show, so a new chat starts clean; earlier results stay on the Routines page. Existing bots start at the migration.
