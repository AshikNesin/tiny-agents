# Model providers

Bots run on [pi-ai](https://github.com/earendil-works/pi) providers. By
default that is the Cloudflare AI Gateway alone, so provider keys live in the
gateway (BYOK). `AI_PROVIDERS` swaps or adds any pi-ai built-in provider, for
example OpenAI called directly with your own key.

## Configuration

`AI_PROVIDERS` is a comma-separated list of pi-ai provider ids, in order:

| `AI_PROVIDERS`                 | Bots use                                  |
| ------------------------------ | ----------------------------------------- |
| unset                          | Cloudflare AI Gateway (`CLOUDFLARE_*`)    |
| `openai`                       | OpenAI directly (`OPENAI_API_KEY`)        |
| `cloudflare-ai-gateway,openai` | Both: the gateway's catalog and OpenAI's  |
| `openai,anthropic`             | OpenAI and Anthropic directly, no gateway |

Each provider reads its own credentials from the environment, as pi-ai
defines them: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`OPENROUTER_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`,
`DEEPSEEK_API_KEY`; the gateway needs `CLOUDFLARE_API_KEY`,
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_GATEWAY_ID`. An unknown id is logged
and ignored; a list with no known id falls back to the gateway. Restart after
changing any of these.

## Model ids

The first provider in the list is the primary one: its models keep bare ids
(`gpt-5` with `AI_PROVIDERS=openai`). Every other provider's models are
namespaced `custom:<provider>/<model>` (`custom:openai/gpt-5` with
`AI_PROVIDERS=cloudflare-ai-gateway,openai`), the same form the gateway's BYOK
providers (`GATEWAY_CUSTOM_PROVIDERS`) use. Saved bots store these ids, so
reordering the list changes which ids are bare: a bot whose model id no longer
resolves shows "no longer available" until it is given a model again.

`DEFAULT_MODEL`, `MEMORY_CAPTURE_MODEL`, `CHAT_TITLE_MODEL`, `VISION_MODEL`
and `GATEWAY_MODEL_ALLOWLIST` take ids in the same form.

## Which models are listed

At boot the runtime checks each provider's credentials with pi-ai's own auth
check. Once any provider is configured, providers without credentials are
left out of the model picker, since they could not answer. With none
configured every model is listed, and the chat shows a banner with each
provider's setup hint and disables sending. When more than one provider
serves models, the picker's groups name the provider.

`GET /api/bots/models` returns `providers` (`id`, `name`, `configured`,
`setupHint`) alongside the models; `gatewayConfigured` now means "some
provider can answer" and keeps its name for existing clients.

## Claude subscription

`claude-code/<model>` is not a pi-ai provider. Those rows use the
experimental Claude Code worker and your Pro/Max plan. They are listed
beside whatever `AI_PROVIDERS` is set to, labelled "uses your Claude plan".
An `ANTHROPIC_API_KEY` for the `anthropic` provider must be a console key.
An `sk-ant-oat` token is refused at boot. See
[Use your Claude subscription](../claude-subscription.md).

## What still needs the gateway

- `GATEWAY_CUSTOM_PROVIDERS` and `GATEWAY_BASE_URL` route through the gateway,
  so they register only when `cloudflare-ai-gateway` is in the list.
- Auto-review's classifier ([auto-review](./auto-review.md)) calls the
  gateway's Workers AI route; without the gateway settings auto-review stays
  off.
- The vision side-call can also use `VISION_BASE_URL` + `VISION_API_KEY`
  (any OpenAI-compatible endpoint, e.g. `https://api.openai.com/v1`) when no
  listed provider serves a vision model.

The code lives in `packages/agent/src/models.ts` (`aiProviderIds`,
`createProviderModels`, `configuredProviderIds`) and
`AgentRuntime.providerStatus()`.
