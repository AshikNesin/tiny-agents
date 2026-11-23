---
"tiny-agents": patch
"@tiny-agents/models": patch
---

Model endpoint probes need step-up, and the private-network ban now holds on the model-call transport. `POST /models/discover` and `POST /models/test` take the same connection payload as the routes that save it, so a stolen session could probe internal hosts with a caller-chosen `allowPrivateNetwork`; both now require the vault's step-up like their siblings, and the settings dialogs prompt for it. A model call no longer trusts the one-shot DNS check made before it: the transport follows redirects itself, resolving each hop against the private-address ban, so an endpoint that redirects to `169.254.169.254` (or a DNS-rebinding host) is refused unless the account allows a private endpoint.

MCP OAuth callbacks are single-use, short-lived and bound to the owner who started them. The `state` parameter now carries the issuing user and a timestamp inside the sealed blob, is cleared after any completion attempt (success or failure), expires after ten minutes, and the public callback is rate-limited; a callback carrying a session that isn't the one that started the sign-in is refused.
