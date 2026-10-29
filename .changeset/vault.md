---
"@tiny-agents/agent": minor
"@groot/core": patch
"groot": minor
"@groot/web": minor
---

Add the vault (issue #56): bots use the owner's logins, cards, one-time codes and API keys by handle, and the model never sees a value. The agent package gains the `VaultBroker` port and `SecretValue`, a process-wide `secretRedactor` that scrubs every gated tool result and the transcript view, gate plans for tools (`withGatePlan`: refuse, ask regardless of permission, add to the card, offer a "for this chat" grant kept in the new `tiny.grants` document, expire the approval), expiring owner waits, the `vault` toolkit (`vault_list`), `browser_fill_secret`, `browser_enter_code` and `request_credentials` in the browser toolkit (with an in-page origin check and a login/payment form classifier), and `http_request` in the web toolkit. `AgentRuntime.decideApproval` takes `{ grant }`, and `credentialRequest` / `settleCredentialRequest` answer credential requests; new chat tool statuses are `awaiting_credentials` and `expired`. Core's logger and Sentry run every message through a scrubber the app can register (`setScrubber`). The schema adds `VaultItem`, `VaultAuditEvent` and `Connection.secretRef`. The app ships 1Password Connect and local backends, the Vault page with step-up, credential request sheets, and vault approval cards; see docs/features/vault.md.
