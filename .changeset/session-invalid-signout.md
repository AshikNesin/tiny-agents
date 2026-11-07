---
"@groot/core": minor
"@groot/shell": minor
"@groot/web": patch
---

The client signs the owner out only when the session guard rejects the
session, never on a credential failure.

- `@groot/core`: the session guard (`jwtAuthMiddleware` and `verifyToken`)
  answers a missing, invalid or expired token with a 401 coded
  `SESSION_INVALID` (`ErrorCode.SESSION_INVALID`, thrown by the new
  `sessionInvalid()` in `utils/jwt.utils`). Before, it was coded
  `UNAUTHORIZED`. Every other 401, such as a wrong password, an unknown
  passkey or a missing admin key, keeps `UNAUTHORIZED`.
- `@groot/shell`: `apiClient.onUnauthorized` handlers run only for a
  `SESSION_INVALID` response, not for every 401. A login form or step-up
  dialog that gets a plain 401 shows the server's message and the owner stays
  signed in. `UnauthorizedEvent` is unchanged.
- `@groot/web`: a refused vault step-up (wrong password or unknown passkey)
  answers 401 with the server's message. The route no longer converts core's
  401 to 403 by hand.
