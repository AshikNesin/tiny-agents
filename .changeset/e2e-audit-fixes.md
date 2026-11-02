---
"@groot/web": patch
---

Fixes from the E2E friction audit (issues #119, #121–#124, #127). The
/memory page no longer sticks on "No bots yet" when its bots load loses a
race with the app shell's. The skills and connections dialogs validate
inline and surface test-connection failures in the dialog. The vault's
New item is disabled with a reason while the primary backend can't save,
and its failures read "SECRETS_KEY is not set." instead of the bare code
"unconfigured". The mobile drawer lists Routines, Skills, Memory,
Connections and Vault directly. Dev and Playwright boot the server with a
1024MB heap cap; 512 OOM-crashed at startup.
