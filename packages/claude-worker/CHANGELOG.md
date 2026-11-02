# @tiny-agents/claude-worker

## 0.2.0

### Minor Changes

- [#117](https://github.com/AshikNesin/tiny-agents/pull/117) [`4814aca`](https://github.com/AshikNesin/tiny-agents/commit/4814aca75211052126f2dfdd163f16ebbb6d50f0) Thanks [@AshikNesin](https://github.com/AshikNesin)! - Experimental Claude Pro/Max inference. Bots can select `claude-code/<model>`
  ("uses your Claude plan"). Turns go to a loopback worker that drives the
  official Claude Agent SDK. tiny-agents does not read, store, or refresh the
  Claude login, does not set `ANTHROPIC_BASE_URL`, and refuses to boot when
  model-provider config contains an `sk-ant-oat` token. `CLAUDE_CODE_ENGINE_ENABLED`
  is the kill switch. Default fallback is pause.
