---
"tiny-agents": major
"@tiny-agents/agent": major
---

Models are owner data (issue #179, ADR 0016).

- **Provider accounts and models are database rows.** Each account has a kind (Anthropic, OpenAI Chat, OpenAI Responses, Gemini, Cloudflare AI Gateway, Claude plan) and a key kept as an `app` vault item. Changes apply without a restart.
- **Bots point at a model row**, not a string. The `custom:` and `claude-code/` id forms and the "primary provider" are gone. A bot without a model runs on the default model.
- **Model roles** (`bot_default`, `memory_capture`, `chat_title`, `vision`, `classifier`) replace `DEFAULT_MODEL`, `MEMORY_CAPTURE_MODEL`, `CHAT_TITLE_MODEL`, `VISION_*` and `CLASSIFIER_MODEL`, and the hardcoded title, vision and classifier defaults.
- **The Claude plan is a provider account.** It replaces `CLAUDE_CODE_ENGINE_ENABLED` and `CLAUDE_CODE_ENGINE_FALLBACK`; its fallback is a model.
- **`@tiny-agents/agent`.** `AgentRuntime.open` takes `modelConfig` and `credentials` instead of `env` and `provider`; `applyModelConfig` replaces them while running. `ModelInfo` is `CatalogModel`; `createClassifier` and `createTranscriber` read roles from the runtime's catalog.
- **Breaking.** `AI_PROVIDERS`, provider `*_API_KEY`s, `CLOUDFLARE_*`, `GATEWAY_*` and the variables above are no longer read. Set models up again; existing bots run on the default model until you pick one.
