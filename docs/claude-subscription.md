# Use your Claude subscription (experimental)

This path lets a bot answer on a Claude Pro or Max subscription. Claude
Code, on a machine you control, is the only process that holds the login.
tiny-agents never reads it, stores it, or refreshes it.

**This can still put the Claude account at risk.** Anthropic's terms
restrict how subscription access is used, and they have blocked
third-party apps that impersonate Claude Code or relay its requests.
Read this page before you turn the engine on. If you are unsure, leave
`CLAUDE_CODE_ENGINE_ENABLED` unset and use the gateway.

## What this project will not do

- It will not read the Keychain, Claude Code's credential file, or an
  OAuth token. `claude auth login` and `claude setup-token` are commands
  you run yourself, on the worker machine.
- It will not set `ANTHROPIC_BASE_URL` or proxy an Anthropic request.
  There is no turn relay. The official Agent SDK drives the unmodified
  `claude` binary.
- It will not spoof the Claude Code client. If any model-provider value
  contains an `sk-ant-oat` token, tiny-agents refuses to boot. pi-ai
  impersonates Claude Code when it sees one.
- It will not run Claude Code's own tools. The worker starts with
  `tools: []`, `strictMcpConfig: true`, `settingSources: []`, and
  `CLAUDE_CODE_MAX_RETRIES=0`. A tool call comes back to tiny-agents,
  through the same approval gate as any other bot, and the result is
  returned. Claude Code does not execute it.

## What you are turning on

A model id `claude-code/<model>` (the picker labels these "uses your
Claude plan") selects `ClaudeCodeEngine`. Every other bot stays on the
pi-durable harness.

The app opens one WebSocket to the worker (`CLAUDE_WORKER_URL`,
`CLAUDE_WORKER_TOKEN`). The worker keeps one Claude Code `query()` per
conversation and feeds later turns with `streamInput()`. After a restart
it passes `resume: sessionId`. The socket pings every 20 seconds and
closes after 60 seconds of silence. Reconnect waits from 1 second up to 30. Events carry a per-session sequence number; the worker keeps about
1000 of them so a reconnect continues. Tool calls are idempotent on
`tool_use_id`. A tool result that does not arrive in 120 seconds becomes
an error result. An idle Claude process is evicted after 15 minutes. A
process older than 6 hours is recycled and resumed. At most two Claude
processes are live, and one turn runs at a time. Those timings are the
defaults; the `CLAUDE_WORKER_*` variables in
[config](reference/config.md) override them.

The worker binds `127.0.0.1` only. Publish it with `tailscale serve`.
Do not use Funnel and do not open a public port. The bearer token is
checked before the WebSocket upgrade. Run the worker as a normal user,
not an admin.

If Claude Code reports a rate limit with status `rejected`, error code
`credits_required`, or `isUsingOverage` (that last field is undocumented
and only checked when it is present), the turn pauses and is not retried.

## Kill switch

`CLAUDE_CODE_ENGINE_ENABLED` is read on each turn, in tiny-agents. Set it
to `1` to allow turns. Unset it, or set `0`, and the app stops sending
turns. The worker can keep running. You do not redeploy it to shut the
feature off.

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

## Set up the worker

- macOS, including a Cua/Lume VM on a Mac mini: [claude-worker-macos.md](guides/claude-worker-macos.md)
- Linux: [claude-worker-linux.md](guides/claude-worker-linux.md)

Settings → Claude plan shows whether the kill switch is on and whether a
worker host is configured. It has no credential fields.

## Manual smoke test

Run this on a fresh VM after the guide, before you point a real bot at
it. CI does not call Anthropic. This checklist is the live check.

1. `claude auth status` prints `loggedIn: true` and a `subscriptionType`
   (`pro` or `max`). It does not print a token. If it does not, stop and
   run `claude auth login` or `claude setup-token` yourself.
2. Confirm the worker process environment has no `ANTHROPIC_API_KEY`,
   `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and no Bedrock, Vertex,
   or Foundry flag. The worker must refuse to start when any of those
   are set.
3. `claude-worker` listens on `127.0.0.1` only (`lsof -nP -iTCP:8765` or
   `ss -ltnp`). From another machine, the port is closed.
4. `tailscale serve status` shows a tailnet HTTPS proxy to that port.
   `tailscale funnel status` shows nothing for it.
5. A client that is not tagged `tag:tiny-agents` cannot open the worker
   URL. A client with the tag can.
6. A WebSocket without `Authorization: Bearer <CLAUDE_WORKER_TOKEN>` is
   rejected with 401.
7. In tiny-agents, leave `CLAUDE_CODE_ENGINE_ENABLED` unset, pick a
   "uses your Claude plan" model, and send. The turn pauses (or uses the
   gateway, if you set that fallback). The worker log shows no new turn.
8. Set `CLAUDE_CODE_ENGINE_ENABLED=1` and restart tiny-agents only. Send
   again. The reply streams. Claude Code's own shell and edit tools do
   not appear; a tiny-agents tool asks you before it runs.
9. Leave the chat idle for several minutes. The socket stays up (pings
   in the worker log). It should still be up after an hour.
10. Stop the worker. The next turn pauses or falls back, and tiny-agents
    does not retry it in a loop. Start the worker. The next turn resumes
    the same Claude session (`resume` in the worker log) rather than
    starting a stranger conversation.
11. Search the tiny-agents host for `sk-ant-oat`. The app database, the
    agent store, and `.claude.json` session file must not contain one.
