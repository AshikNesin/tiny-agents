---
"@groot/web": patch
---

Add a `DATA_DIR` environment variable for the production data directory (default `/data`, so Docker behavior is unchanged). Outside Docker — e.g. a bare-metal macOS run — `/data` is not writable and boot failed with `ENOENT: mkdir /data`; set `DATA_DIR` to a writable path to move the app database (`app.db`), agent store (`agent.db`) and their sibling uploads directory together. Explicit `DATABASE_URL` / `AGENT_DB_PATH` / `UPLOADS_DIR` values still win.
