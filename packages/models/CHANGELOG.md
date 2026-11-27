# @tiny-agents/models

## 0.2.0

### Minor Changes

- [#509](https://github.com/AshikNesin/tiny-agents/pull/509) [`7c34436`](https://github.com/AshikNesin/tiny-agents/commit/7c3443651e369eb579b5aa32c30ff7d90a7e4b45) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Code has a third agent, Native, built on the same runtime the chat bots use. It needs a sandbox and a model that runs on pi, and no other setup. A Native thread reads, writes and edits files and runs commands in its working directory on the sandbox, asks before it changes anything unless its permission mode says otherwise, takes a steer or a queued message while it works, and can be stopped, forked, compacted and continued after an error. Settings → Models has a new default, New Code threads, for the model a Native thread starts on.
  
  For developers: `AgentRuntime` gains `cwd` on a conversation's config, `fork`, `compact` and `continueReply`; `@tiny-agents/agent` exports `createCodingToolkit` and `codingSelection`; `@tiny-agents/code/server` exports `createPiHarness` and its `PiPort`; the model catalog has a `code_default` role; and a sandbox `exec` takes an abort `signal`.

### Patch Changes

- [`e88ecdd`](https://github.com/AshikNesin/tiny-agents/commit/e88ecdd64efc79d8f82b504332b61c3cffd29aa6) Thanks [@ampagent](https://github.com/ampagent)! - Model endpoint probes need step-up, and the private-network ban now holds on the model-call transport. `POST /models/discover` and `POST /models/test` take the same connection payload as the routes that save it, so a stolen session could probe internal hosts with a caller-chosen `allowPrivateNetwork`; both now require the vault's step-up like their siblings, and the settings dialogs prompt for it. A model call no longer trusts the one-shot DNS check made before it: the transport follows redirects itself, resolving each hop against the private-address ban, so an endpoint that redirects to `169.254.169.254` (or a DNS-rebinding host) is refused unless the account allows a private endpoint.
  
  MCP OAuth callbacks are single-use, short-lived and bound to the owner who started them. The `state` parameter now carries the issuing user and a timestamp inside the sealed blob, is cleared after any completion attempt (success or failure), expires after ten minutes, and the public callback is rate-limited; a callback carrying a session that isn't the one that started the sign-in is refused.
- Updated dependencies [[`54143fb`](https://github.com/AshikNesin/tiny-agents/commit/54143fbd55708fab2684c0f8041189b3e29307df), [`566e80d`](https://github.com/AshikNesin/tiny-agents/commit/566e80df2f2d2ba9ad59d812d5f56170aafd6347), [`dadbaf1`](https://github.com/AshikNesin/tiny-agents/commit/dadbaf1810244339d908e356695882f03b0497f8), [`e511da5`](https://github.com/AshikNesin/tiny-agents/commit/e511da53df9f14db7849c0cdf861c34e2689baac)]:
  - @tiny-agents/claude-worker@0.5.0

## 0.1.2

### Patch Changes

- [#483](https://github.com/AshikNesin/tiny-agents/pull/483) [`20f32d8`](https://github.com/AshikNesin/tiny-agents/commit/20f32d8bc1f3b1c3f4cf6fd4899ce6f9092b2cc8) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Runs on pi-durable, pi-ai and chord 1.6.0. Chat streams render from the conversation view instead of the removed event stream, and a reply that a crash or the restart limit cut off says so in words.

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
