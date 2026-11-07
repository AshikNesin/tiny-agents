---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

Models fixes from real use against Cloudflare AI Gateway (issues #215, #216).

- **Custom providers on the gateway (#216).** A gateway account lists the custom providers configured in the gateway (slug and base path, e.g. `custom-zai-coding-plan`, `api/coding/paas/v4`). Their models appear beside Claude and the TypeSafe classifier in the same account, discovered through the gateway, and run on its token. Add them when connecting or from the card's **Custom providers**.
- **Claude Sonnet 5.5 and Opus 5.5 work.** Calls without a thinking level (Test, chat titles, memory capture) no longer send `thinking: disabled`, which these models refuse.
- **Clearer gateway models.** Workers AI catalog models are named `… (Workers AI)`; Test explains a missing BYOK key or Unified Billing credits (402) and a Workers Paid-only model (403).
- **Settings → Models (#215).** Reset stays inside the Default models card, and every model picker (default models, the Claude plan fallback, moving bots, the bot's model) is searchable.
