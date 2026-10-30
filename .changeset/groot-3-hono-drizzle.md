---
"@groot/web": minor
"@groot/core": minor
"@groot/jobs": minor
"@groot/shell": minor
"@groot/ui": minor
"@tiny-agents/agent": patch
---

Move to groot 3.0: Hono instead of Express, Drizzle on SQLite instead of
Prisma, a table-backed job queue instead of honker, code config instead of
config.yml and varlock. tiny-agents stays on Node (Chromium, ssh2 and the
pi-durable store run in-process).

- **Your data moves over on the first boot.** A database from the Prisma
  build is renamed to `app.db.prisma-backup-<time>` and every row is copied
  into the new layout: users, passkeys, bots, past chats, skills, connections,
  messages, tasks, vault items and audit events, uploads, routines and runs,
  memories, the notification log, and key-value settings (local vault
  secrets, SSH host keys, app and notification settings). Routines re-arm
  their next run on boot.
- **Existing passwords keep working.** A bcrypt hash from the old build is
  accepted once and replaced with a PBKDF2 hash on that sign-in. Vault
  step-up accepts both.
- **Uploads persist across redeploys.** They now live beside the database
  (`/app/data/uploads` with the current volume) instead of `./local/uploads`
  in the container; files still in the old folder are copied over.
- The groot 3.0 UI refresh comes along: one control height scale, rounder
  surfaces, toasts that follow dark mode, CodeMirror on the theme tokens, and
  the warm palette now lives in the shell (app.css keeps only chat tokens).
- Fixes found on the way: a bot edit that only changed its skills or
  connections returned 500 under Drizzle; the login page showed the raw error
  instead of "Invalid email or password" with the fetch client; a server
  error message without a code (the terminal's, for one) was replaced by the
  generic fallback. `ApiError` now carries `fromServer` to tell the two apart.
