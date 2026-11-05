# ADR 0010: The Claude worker runs on the sandbox, set up by the app

- Status: **accepted** (supersedes the worker setup in [0008](0008-claude-code-engine.md); tunnel amended by [0013](0013-one-sandbox-connection.md))
- Date: 2026-11-04

## Context

ADR 0008 put Claude Code in a separate worker on a VM the owner set up by
hand: install Claude Code and the Agent SDK, clone the repo, write a token
file, install a systemd unit or LaunchAgent, `tailscale serve` the port,
write a tailnet grant, then copy the URL and token into tiny-agents. That is
a dozen steps for one feature, and the owner asked for "enable it and start
using it".

The browser, the computer and the terminal already solved the same shape of
problem: the app reaches the sandbox VM (or the local sandbox container)
over SSH, installs what it needs on first use, starts it on the sandbox's
loopback and tunnels to it. Other apps that drive Claude Code on a
subscription, such as [T3 Code](https://github.com/pingdotgg/t3code) and
[AgentsInTheCloud](https://github.com/lucasmeijer/AgentsInTheCloud), ask only
for Claude Code to be installed and logged in on the machine that runs the
agent.

## Decision

- The worker runs **on the sandbox**, and only there. On first use (at boot when
  `CLAUDE_CODE_ENGINE_ENABLED` is on, or when Settings is opened) the app,
  over the sandbox SSH endpoint:
  1. installs Node when the sandbox has no Node 20+ with npm (an official
     build, no apt), then the **pinned** `@anthropic-ai/claude-agent-sdk`,
     `@anthropic-ai/claude-code`, `ws` and `zod`;
  2. uploads the bundled worker (`dist/server/claude-worker.mjs`; dev
     bundles it from source) and records its hash;
  3. starts it on `127.0.0.1:8765` inside the sandbox with a 32-byte token
     it creates there once (0600), restarting it when the bundle changes or
     the process is gone;
  4. connects through an SSH direct-tcpip tunnel, one SSH connection per
     WebSocket, the same pattern as the browser's CDP tunnel. (Amended by
     ADR 0013: each WebSocket is a forward on the app's one sandbox
     connection.)
- The local sandbox image preinstalls step 1 in `/opt/tiny-agents/claude-worker`
  so a container never waits on npm. A test keeps its pins equal to the app's.
- The owner's only step is the login. **Settings → Claude plan → Sign in**
  opens a terminal tab that types `claude auth login`; the owner finishes it
  in Claude Code's own prompt. The app never sees the URL, the code or the
  token, and Claude Code keeps the login on the sandbox (`~/.claude`).
  Settings reads `claude auth status` for loggedIn and the plan name only.
- The hand-run worker is removed: no `CLAUDE_WORKER_URL` or
  `CLAUDE_WORKER_TOKEN`, no macOS/Linux worker guides, no unit files. One
  path keeps the feature simple to set up and to reason about.
- Everything else in 0008 stands: no Claude credential in tiny-agents, no
  `ANTHROPIC_BASE_URL`, no relay, Claude Code's own tools empty, the kill
  switch read on each turn, two live processes and one running turn. The
  launcher unsets the API-key, base-URL and Bedrock/Vertex/Foundry overrides
  before the worker starts, so a stray variable in the sandbox user's shell
  cannot move Claude Code off the subscription login.

## Consequences

- With a sandbox configured, turning the feature on is
  `CLAUDE_CODE_ENGINE_ENABLED=1` plus one sign-in. No Tailscale serve, grant,
  token or unit file.
- The sandbox user's home now holds the Claude login, next to the bots' own
  files. Bots' `run_command` runs as the same user, so a bot with sandbox
  access could read `~/.claude`. That is the same exposure as any other
  login the owner makes on the sandbox (a browser profile, a `gh` token).
- A Mac whose Claude login sits only in the Keychain is no longer a worker
  host; sign in on the sandbox instead.
- The worker no longer refuses to start without a login: it listens, and
  each session checks `claude auth status` before Claude Code runs, so a
  turn before sign-in pauses with the sign-in hint.
- Pins move by editing `CLAUDE_WORKER_PACKAGES` and bumping
  `CLAUDE_WORKER_STACK_VERSION` (and the Dockerfile ARGs; the test fails
  otherwise). Existing sandboxes reinstall on the next use.
- `pnpm build` emits `claude-worker.mjs` next to the server bundle.

## Alternatives considered

- **Keep the hand-built worker as the only path, or as an override.**
  Rejected: it is the friction this ADR removes, and a second path is a
  second thing to configure, document and test.
- **Run the Agent SDK in the app and spawn `claude` over SSH**
  (`spawnClaudeCodeProcess`). Fewer moving parts on the sandbox, but the
  SDK would live in the app process, and session resume, the process caps
  and the reconnecting protocol in the worker would have to be rebuilt.
- **Copy a `claude setup-token` value into the app's env.** Rejected by 0008:
  tiny-agents must never hold a subscription credential.
