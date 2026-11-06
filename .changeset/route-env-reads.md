---
"@tiny-agents/agent": minor
"@tiny-agents/claude-worker": minor
"@groot/web": patch
---

Every environment read goes through a validated env module, and lint rule R3
(`repo/no-raw-env`) fails any other `process.env` read with a message naming
`appEnv()`, core `env` and the schema.

- `@tiny-agents/agent` no longer reads `process.env`. `AgentRuntime.open` and
  `ClaudeCodeEngine` read the `env` they are given (default empty), and
  `aiProviderIds`, `primaryProviderId`, `isGatewayConfigured`,
  `createProviderModels`, `registerGatewayCustomProviders`,
  `assertNoClaudeOauthToken`, `createClassifier` and `createTranscriber` take
  `env` as a required argument. The Node entry passes `process.env`.
- `@tiny-agents/claude-worker`: `readClaudeAuth`, `requireSubscriptionLogin`
  and `createSdkQueryFactory` take `env` as a required argument, and
  `createClaudeWorkerServer` defaults it to empty. The worker's entry passes
  `process.env`.
- `@groot/web`: the sandbox, browser, computer, TinyFish, TZ, SECRETS_KEY and
  Claude plan variables join the `appEnv()` schema, and the app reads them,
  SHELLEY_URL, ORIGIN and NODE_ENV only through `appEnv()` or core `env`.
