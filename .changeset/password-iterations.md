---
"@groot/core": patch
"tiny-agents": patch
---

Passwords hash with PBKDF2 at 600,000 iterations (OWASP's current floor) instead of 100,000. Existing hashes stay valid, and the next successful password login re-hashes the account at the new count, the same path bcrypt hashes already took.

An admin-key check that fails now counts against a per-IP limit (10 failed keys per 15 minutes by default, `config.rateLimits.adminKey`), so the header can't be brute-forced online; correct keys are never counted.

SECRETS_KEY must hold at least 32 bytes of key material (counted after base64 or hex decoding) before it seals anything; a weaker key gets a clear error naming the variable instead of silently encrypting with low entropy. Reading is unchanged: values sealed before the floor still open, so an operator can tighten the key with `pnpm secrets:rotate` without losing data.
