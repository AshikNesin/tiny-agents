---
"@tiny-agents/sandbox": minor
---

One VM stack and one shell module (rewrite step 3.6, no behavior change).

- **New root exports:** `bashScript`, `exitWith`, `exitSentinel` and `failureDetail` join `shQuote`, which now comes from the same module. Every command sent to the sandbox VM is quoted, wrapped and has its exit code read through them.
- **Unchanged:** every script the browser, the computer, the Claude worker, confined commands and the terminal send over SSH is byte-for-byte what it was, so existing VMs keep their markers, locks and pid files.
