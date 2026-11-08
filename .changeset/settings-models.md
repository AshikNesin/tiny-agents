---
"tiny-agents": minor
"@tiny-agents/agent": minor
---

Settings → Models (issue #179, slice 4).

- **Add models.** Connect a provider from a template or by kind, check which models its endpoint lists and keep the ones you want; or add a single model by id, test it, and add it. Keys go straight into the vault.
- **Accounts and models.** Status, key hint, enable and disable, check again, edit the endpoint or key, delete (confirming first, then moving the bots that use it), per-model Test, and the Claude plan's fallback model.
- **Default models.** Pick the model for new bots, memory capture, chat titles, image transcription and auto-review.
- **Safe by default.** Creating, editing and deleting an account need step-up; discovery refuses private addresses unless the account allows them, follows no redirects and caps size and time; no route returns a key.
- **`@tiny-agents/agent`.** `discoverModels`, `resolveCapabilities`, `PROVIDER_TEMPLATES` and `testModelCall` for the app's routes.
