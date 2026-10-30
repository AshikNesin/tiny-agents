---
"@groot/web": patch
---

`SANDBOX_HOST` now defaults to the production VM only in production. On a
fresh development or test setup it is empty, so the browser runs a local
headless Chromium instead of failing with `getaddrinfo ENOTFOUND
tiny-agents-vm`, the terminal shows "not configured", and the live terminal
e2e specs skip themselves as intended. Production is unchanged: it still
defaults to `tiny-agents-vm`, and the sandbox, attachments, browser and
terminal now all read the host the same way.
