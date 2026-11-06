---
"@tiny-agents/agent": minor
---

One Model catalog owns model ids. `AgentRuntime.catalog` (`ModelCatalog`) lists
the picker's models, says which ids a bot can run on (`has`), resolves an id to
its registry model (`resolve`, `model`), gives one model's entry (`info`) and
the providers' status (`providers`, `canAnswer`). It replaces
`listModels()`, `hasModel()`, `providerStatus()` and `hasConfiguredProvider()`
on the runtime, and `resolveModelId` in the policy module. The `custom:` and
`claude-code/` grammar now lives only in `parseModelId`/`formatModelId`; the
vision transcriber and Side-calls use it instead of their own parsers.

A Claude plan bot's Side-calls (memory capture) run on the same model when a
registry provider serves it, instead of always being skipped. Whether a bot's
model sees images no longer depends on the picker's allowlist.
