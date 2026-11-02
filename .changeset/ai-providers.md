---
"@tiny-agents/agent": minor
---

Bots can run on any pi-ai provider, not only the Cloudflare AI Gateway.
`AI_PROVIDERS` lists provider ids in order (default `cloudflare-ai-gateway`),
e.g. `openai` to call OpenAI directly with `OPENAI_API_KEY`, or
`cloudflare-ai-gateway,openai` for both. The first provider's models keep bare
ids; the others' read `custom:<provider>/<model>`. `createProviderModels`
replaces `createGatewayModels` (kept as an alias), and the runtime gains
`providerStatus()` and `hasConfiguredProvider()`, which the models endpoint
returns as `providers` with a setup hint per provider. Once any provider has
credentials, unconfigured providers' models are no longer listed. Model
infos carry the serving provider's name.
