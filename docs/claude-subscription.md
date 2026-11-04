# Use your Claude subscription (experimental)

This path lets a bot answer on a Claude Pro or Max subscription through
Claude Code. tiny-agents installs and runs Claude Code on your **sandbox**
(the VM or local container the browser and terminal already use). You turn
it on and sign in once. Claude Code holds the login on the sandbox;
tiny-agents never reads, stores or refreshes it.

**This can still put the Claude account at risk.** Anthropic's terms
restrict how subscription access is used, and they have blocked
third-party apps that impersonate Claude Code or relay its requests.
Read [what this project will not do](#what-this-project-will-not-do)
before you turn the engine on. If you are unsure, leave
`CLAUDE_CODE_ENGINE_ENABLED` unset and use the gateway.

## Turn it on

You need a sandbox: `SANDBOX_HOST` (the Tailscale VM) or the local
container from `pnpm sandbox:up` ([local sandbox](guides/local-sandbox.md)).

1. Set `CLAUDE_CODE_ENGINE_ENABLED=1` and restart tiny-agents.
2. Open **Settings → Claude plan**. On first use the app installs Node,
   the Agent SDK and Claude Code on the sandbox (a minute or two; the
   local container has them preinstalled). The card shows the progress.
3. Choose **Sign in to Claude**. A terminal tab opens and types
   `claude auth login`. Open the link it prints, approve, and paste the
   code back into the tab. The card then shows "Signed in to Claude (max)".
4. Give a bot a model labelled "uses your Claude plan".

That's all. There is no URL, token, unit file or Tailscale serve to set
up. The login survives restarts of the app and of the sandbox.

### What the app does on the sandbox

All of it under one directory: `/opt/tiny-agents/claude-worker` in the
local container image, `~/.tiny-agents/claude-worker` on a VM.

- Installs Node when the sandbox has no Node 20+ with npm (an official
  build from nodejs.org, no apt, no sudo), then the pinned
  `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/claude-code`, `ws` and
  `zod`.
- Uploads the worker (one bundled file) and starts it on
  `127.0.0.1:8765` inside the sandbox with a random 32-byte token it
  creates there (0600). It is restarted when the app's bundle changes or
  the process is gone (a sandbox reboot), on the next turn.
- Connects to it through an SSH tunnel over the sandbox's existing SSH
  endpoint. Nothing is published on the network.
- Links `~/.local/bin/claude` to that CLI when the sandbox has no `claude`
  of its own, so a terminal tab can run it.

Logs are in `worker.log` in that directory.

## What this project will not do

- It will not read the Keychain, Claude Code's credential file, or an
  OAuth token. The login is `claude auth login`, which you complete in
  Claude Code's own prompt; the app only opens the terminal tab. It reads
  `claude auth status` for `loggedIn` and the plan name, nothing else.
- It will not set `ANTHROPIC_BASE_URL` or proxy an Anthropic request.
  There is no turn relay. The official Agent SDK drives the unmodified
  `claude` binary. The launcher unsets `ANTHROPIC_API_KEY`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the Bedrock, Vertex and
  Foundry flags before the worker starts, and the worker refuses them too.
- It will not spoof the Claude Code client. If any model-provider value
  contains an `sk-ant-oat` token, tiny-agents refuses to boot. pi-ai
  impersonates Claude Code when it sees one.
- It will not run Claude Code's own tools. The worker starts with
  `tools: []`, `strictMcpConfig: true`, `settingSources: []`, and
  `CLAUDE_CODE_MAX_RETRIES=0`. A tool call comes back to tiny-agents,
  through the same approval gate as any other bot, and the result is
  returned. Claude Code does not execute it.

The login lives in the sandbox user's home, as any other login you make
there does. Bots that run commands on the sandbox run as that user, so
treat the Claude login like any other login you keep on the sandbox.

## How turns flow

A model id `claude-code/<model>` (the picker labels these "uses your
Claude plan") selects `ClaudeCodeEngine`. Every other bot stays on the
pi-durable harness.

The app opens one WebSocket to the worker. The worker keeps one Claude
Code `query()` per conversation and feeds later turns with
`streamInput()`. After a restart it passes `resume: sessionId`. The
socket pings every 20 seconds and closes after 60 seconds of silence.
Reconnect waits from 1 second up to 30. Events carry a per-session
sequence number; the worker keeps about 1000 of them so a reconnect
continues. Tool calls are idempotent on `tool_use_id`. A tool result that
does not arrive in 120 seconds becomes an error result. An idle Claude
process is evicted after 15 minutes. A process older than 6 hours is
recycled and resumed. At most two Claude processes are live, and one turn
runs at a time. Those timings are the defaults; the `CLAUDE_WORKER_*`
variables in [config](reference/config.md) override them.

If Claude Code reports a rate limit with status `rejected`, error code
`credits_required`, or `isUsingOverage` (that last field is undocumented
and only checked when it is present), the turn pauses and is not retried.

A turn sent before you sign in pauses with the sign-in hint.

## Kill switch

`CLAUDE_CODE_ENGINE_ENABLED` is read on each turn, in tiny-agents. Set it
to `1` to allow turns. Unset it, or set `0`, and the app stops sending
turns. The worker can keep running.

`CLAUDE_CODE_ENGINE_FALLBACK` chooses what a refused or unreachable turn
does:

| Value     | Behaviour                                                            |
| --------- | -------------------------------------------------------------------- |
| `pause`   | Default. The chat shows an error and nothing is sent.                |
| `gateway` | The turn is sent through Cloudflare AI Gateway on the bare model id. |

Gateway fallback spends the gateway's Anthropic key (API credits or
extra usage), not the subscription. The conversation then stays on the
pi transcript. Turns already completed on the subscription remain in the
worker's session and are not replayed into that transcript.

## Max plan, without this engine

If you only want Claude models through the gateway, do not use this
engine and do not paste a Claude Code token anywhere. Create a normal
console API key that spends Max-plan API credits or usage credits, and
store that key only as the Anthropic BYOK secret in Cloudflare AI
Gateway. Details are in [AI inference](features/ai-inference.md).

## Manual smoke test

CI does not call Anthropic. Run this once on a fresh sandbox before you
point a real bot at it.

1. With `CLAUDE_CODE_ENGINE_ENABLED` unset, pick a "uses your Claude
   plan" model and send. The turn pauses (or uses the gateway, if you set
   that fallback). Nothing is installed on the sandbox.
2. Set `CLAUDE_CODE_ENGINE_ENABLED=1` and restart. Settings → Claude plan
   shows "Installing", then "not signed in".
3. Sign in from the card. The terminal tab runs `claude auth login`; after
   it, the card shows the plan.
4. On the sandbox, `ss -ltnp | grep 8765` shows `127.0.0.1:8765` only.
   From another machine the port is closed.
5. Send again. The reply streams. Claude Code's own shell and edit tools
   do not appear; a tiny-agents tool asks you before it runs.
6. Kill the worker on the sandbox (`pkill -f claude-worker/worker.mjs`).
   The next turn starts it again and resumes the same Claude session.
7. Search the tiny-agents host for `sk-ant-oat`. The app database, the
   agent store, and `.claude.json` session file must not contain one.
