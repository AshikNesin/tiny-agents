---
"tiny-agents": patch
---

Fix the 1Password vault on deployed servers: every request failed and the Vault card said 1Password "refused the service account token" with a "reqwest library: error sending request" message. The Node server replaced the global `Response` class, and 1Password's SDK rejects any fetch answer that isn't the built-in `Response`. The server now leaves the globals alone, so no setting changes are needed; redeploy. When the SDK really can't send a request, the card now says 1Password is unreachable from the server instead of blaming the token.
