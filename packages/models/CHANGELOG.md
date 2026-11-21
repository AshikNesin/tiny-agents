# @tiny-agents/models

## 0.1.1

### Patch Changes

- Updated dependencies [[`371f074`](https://github.com/AshikNesin/tiny-agents/commit/371f074ef88bdc69d67e8ba9de5472643b6583ac)]:
  - @tiny-agents/claude-worker@0.4.4

## 0.1.0

### Minor Changes

- [#270](https://github.com/AshikNesin/tiny-agents/pull/270) [`02f4b87`](https://github.com/AshikNesin/tiny-agents/commit/02f4b87e62bb73aad5c82b27aabcb699c8579b01) Thanks [@AshikNesin](https://github.com/AshikNesin)! - New package `@tiny-agents/models`: provider accounts and their models, on pi-ai only (rewrite step 3.3, no behavior change).
  
  - **Moved:** provider kinds and templates, discovery, test calls, `buildProviders` and the Model catalog (`ModelCatalog`, `createModelCatalog`) leave `@tiny-agents/agent` for `@tiny-agents/models`, with the model types they use (`CatalogModel`, `ProviderKind`, `ProviderStatus`, `ProviderSummary`, `ModelRole`, `ModelRoute`, `ModelUnavailableReason`, `AgentEngineKind`).
  - **Boundary:** the package imports neither pi-durable nor `@tiny-agents/agent`; lint R11 fails the build if it does.
  - **`@tiny-agents/agent`:** depends on `@tiny-agents/models`, and its root still exports every name it exported before, re-exported from `@tiny-agents/models` and marked `@deprecated`. Import them from `@tiny-agents/models` instead.

### Patch Changes

- Updated dependencies [[`393dd71`](https://github.com/AshikNesin/tiny-agents/commit/393dd71934f643d83303f57467f54e90318a9b76), [`b5dcf5d`](https://github.com/AshikNesin/tiny-agents/commit/b5dcf5df004bd1294a853ee120c5e0032dc55f78)]:
  - @tiny-agents/claude-worker@0.4.3
