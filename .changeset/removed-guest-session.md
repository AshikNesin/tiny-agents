---
"@groot/core": patch
"tiny-agents": patch
---

The session guard (`jwtAuthMiddleware`) now looks up the token's account and
answers 401 `SESSION_INVALID` when it no longer exists, so the client signs
out. It sets `c.get("user")` from that account. Before, a signed token was
enough, so a guest the owner removed kept a working session until the token
expired, and tiny-agents treated that account (no `guests` row) as the owner.
