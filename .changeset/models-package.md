---
"@tiny-agents/models": minor
"@tiny-agents/agent": patch
---

New package `@tiny-agents/models`: provider accounts and their models, on pi-ai only (rewrite step 3.3, no behavior change).

- **Moved:** provider kinds and templates, discovery, test calls, `buildProviders` and the Model catalog (`ModelCatalog`, `createModelCatalog`) leave `@tiny-agents/agent` for `@tiny-agents/models`, with the model types they use (`CatalogModel`, `ProviderKind`, `ProviderStatus`, `ProviderSummary`, `ModelRole`, `ModelRoute`, `ModelUnavailableReason`, `AgentEngineKind`).
- **Boundary:** the package imports neither pi-durable nor `@tiny-agents/agent`; lint R11 fails the build if it does.
- **`@tiny-agents/agent`:** depends on `@tiny-agents/models`, and its root still exports every name it exported before, re-exported from `@tiny-agents/models` and marked `@deprecated`. Import them from `@tiny-agents/models` instead.
