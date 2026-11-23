---
"@tiny-agents/agent": patch
"@tiny-agents/sandbox": patch
"tiny-agents": patch
---

Vault credentials stay off plaintext http. `http_request` with a vault handle refuses an `http://` URL up front, and a redirect from `https` to `http` on the same host fails before the credential is sent, instead of leaking it to anyone listening on the wire. Plain `http_request` calls without a vault item are unchanged.

A vault approval card now shows the whole command `run_command` can run (up to 20,000 characters, matching the tool's limit) instead of a 2,000-character prefix, so the owner approves what actually runs.

A guest who answers a bot's `ask_owner` questions is named in the answer the model reads ("Priya (guest) answered your questions"), instead of being presented as the owner's own decision.

A vault value filled into a page is no longer handed to frames whose origin the item does not allow: the fill used to serialize the secret into every frame before checking the allowlist, so a cross-origin iframe could read it. It now reaches only the page's own origin and the origins the item names.
