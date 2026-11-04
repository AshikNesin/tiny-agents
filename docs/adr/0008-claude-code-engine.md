# ADR 0008: Claude subscription inference goes through Claude Code

- Status: **accepted**, amended by [0010](0010-claude-worker-runs-on-the-sandbox.md):
  the worker now runs on the sandbox, set up by the app and reached over
  SSH; the hand-run worker behind `tailscale serve` described below is gone.
- Date: 2026-11-02

## Context

tiny-agents sends model calls through pi-ai providers (the Cloudflare AI
Gateway by default, or any other provider in `AI_PROVIDERS`). A Claude
Pro or Max subscription is a different credential: Claude Code holds an
OAuth token (`sk-ant-oat…`) in the macOS Keychain or its own credentials
file, refreshes it, and speaks to Anthropic as Claude Code.

The pinned pi-ai build impersonates that client when it sees an
`sk-ant-oat` token. Doing that from tiny-agents, or relaying Anthropic
requests through a custom `ANTHROPIC_BASE_URL` the way
[pi-claude-code](https://github.com/earendil-works/pi-claude-code) does,
puts the owner's Claude account at risk of a ban. The subscription login
must stay inside Claude Code.

ADR 0005 already records that secrets a bot uses live outside the app.
This decision is the same rule for the owner's Claude account.

## Decision

- Bots keep the pi-durable harness (`PiEngine`) by default. A model id
  `claude-code/<model>` selects `ClaudeCodeEngine`.
- tiny-agents never reads, stores, or refreshes a Claude.ai credential.
  Startup refuses any `sk-ant-oat` value in model-provider config.
- A separate worker process on the owner's VM runs the official
  `@anthropic-ai/claude-agent-sdk` against the unmodified Claude Code
  binary. It does not set `ANTHROPIC_BASE_URL`, does not add a relay, and
  refuses API-key, Bedrock, Vertex, and Foundry overrides.
- Claude Code's own tools are empty. tiny-agents tools are MCP proxies:
  each call comes back over the socket, through the approval gate, and
  only then runs here.
- The worker listens on `127.0.0.1` and is published with `tailscale serve`,
  never Funnel. A 32-byte bearer token is checked at the WebSocket upgrade.
- `CLAUDE_CODE_ENGINE_ENABLED` is the kill switch, read on each turn in
  tiny-agents. Turning it off does not require redeploying the worker.
  `CLAUDE_CODE_ENGINE_FALLBACK` is `pause` (default) or `gateway`.
- Concurrency stays at ordinary individual use: two live Claude processes,
  one running turn.

## Consequences

- A Claude plan bot needs a VM where `claude auth status` shows a
  subscription login, Tailscale, and the worker. The app boots without any
  of that; those bots pause or fall back.
- Gateway fallback spends the gateway's Anthropic key (API credits), not
  the subscription, and latches that conversation onto the pi transcript.
- Tools whose implementation needs the pi-durable task API cannot run on
  this engine yet. The call still goes through the approval gate and then
  returns that error to Claude. Tools that only need their arguments do run.
- CI never imports the Agent SDK and never calls Anthropic. Tests inject
  `query`.

## Alternatives considered

- **pi-claude-code's turn relay.** Rejected. It sets `ANTHROPIC_BASE_URL`
  and handles Anthropic request bytes. That is the path this ADR refuses.
- **Putting the OAuth token in tiny-agents.** Rejected. pi-ai would spoof
  Claude Code, and the app would be holding a credential it must not have.
- **One engine inside the harness by registering a pi provider.** Rejected.
  The harness would still be the thing talking to the model. The SDK has to
  own the Claude Code process.

## Links

- [Claude subscription](../claude-subscription.md)
- [ADR 0010](0010-claude-worker-runs-on-the-sandbox.md)
- [ADR 0005](0005-secrets-live-outside-the-app.md)
