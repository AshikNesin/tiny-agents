---
"tiny-agents": patch
---

Synced groot `0a924aa`: tighter state machines in auth, passkeys and jobs.

- **Auth:** a failed sign-in no longer signs out a signed-in user, and a stale `checkAuth()` answer that arrives after a sign-in or sign-out is dropped. The store exposes `selectAuthStatus()`.
- **Passkeys and jobs:** passkey ceremonies and job transitions reject invalid state changes.
- **Checks:** the changeset gate in a child covers only its own paths, doc-reference checks skip docs synced from groot, and typecheck coverage counts a child's `typecheck:app` projects.
