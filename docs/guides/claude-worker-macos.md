# Claude Code worker on macOS

The worker runs on a Mac that already has a Claude subscription login:
a Mac mini, or a macOS VM on that mini (Cua or Lume). Claude Code keeps
the login in the Keychain of the GUI user. The worker has to run as that
user, in that GUI session. tiny-agents never sees the login.

Do not run this as root. Do not put an `sk-ant-oat` token in tiny-agents.

## 1. The machine

On a Mac mini the host itself is enough. To keep the login off the
machine that runs tiny-agents, use a macOS VM:

- [Lume](https://github.com/trycua/lume) (`lume`) creates the VM.
- [Cua](https://github.com/trycua/cua) is the computer-use stack around
  it. You only need the VM here, not Cua's agent loop. tiny-agents is
  the agent.

Create the VM, sign into a macOS user that is not an admin, and do the
rest of this page inside that VM. Install Tailscale in the VM and tag
the node `tag:claude-worker`. Tag the tiny-agents host `tag:tiny-agents`.

## 2. Claude Code

```sh
npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk
claude auth login
claude auth status
```

`claude auth status` must show `loggedIn: true` and a `subscriptionType`.
If you cannot complete a browser login, run `claude setup-token` in this
same GUI session instead. Claude Code stores that token. If a headless
LaunchAgent cannot see the Keychain, put only `CLAUDE_CODE_OAUTH_TOKEN`
in the 0600 env file below. That file lives on this VM, not on the
tiny-agents host. Do not also set `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_BASE_URL`. The worker refuses to
start when those are set.

## 3. The worker

Clone tiny-agents on the VM (or copy `packages/claude-worker`) and
install dependencies with pnpm. From the repo:

```sh
umask 077
mkdir -p ~/.config/tiny-agents
openssl rand -base64 32 > ~/.config/tiny-agents/claude-worker.token
chmod 600 ~/.config/tiny-agents/claude-worker.env
cat > ~/.config/tiny-agents/claude-worker.env <<EOF
CLAUDE_WORKER_TOKEN=$(cat ~/.config/tiny-agents/claude-worker.token)
CLAUDE_WORKER_PORT=8765
EOF
```

Copy `deploy/claude-worker/com.tiny-agents.claude-worker.plist` to
`~/Library/LaunchAgents/`, replace `USER` and the repo path, and point
`EnvironmentVariables` at the token (or use a wrapper script that
exports the env file). Then:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.tiny-agents.claude-worker.plist
launchctl enable gui/$(id -u)/com.tiny-agents.claude-worker
launchctl kickstart -k gui/$(id -u)/com.tiny-agents.claude-worker
```

`RunAtLoad` and `KeepAlive` are set. Because it is a LaunchAgent in the
logged-in GUI session, the Keychain is available. Confirm it is listening
only on loopback:

```sh
lsof -nP -iTCP:8765 -sTCP:LISTEN
```

The address must be `127.0.0.1`.

## 4. Tailscale

```sh
tailscale serve --bg --yes 8765
tailscale serve status
```

Use `serve`, not `funnel`. Serve publishes HTTPS on the tailnet to the
loopback port. It does not open a public port.

In the tailnet policy, allow only the tiny-agents tag to reach the
worker tag:

```json
{
  "grants": [
    {
      "src": ["tag:tiny-agents"],
      "dst": ["tag:claude-worker"],
      "ip": ["tcp:443"]
    }
  ]
}
```

Nothing else should have a grant to `tag:claude-worker`.

## 5. tiny-agents

On the tiny-agents host, not the VM:

```
CLAUDE_CODE_ENGINE_ENABLED=1
CLAUDE_CODE_ENGINE_FALLBACK=pause
CLAUDE_WORKER_URL=wss://<worker-node>.<tailnet>.ts.net
CLAUDE_WORKER_TOKEN=<the same 32-byte token>
```

`CLAUDE_WORKER_URL` is the Tailscale serve URL with `wss://`. Restart
tiny-agents. Settings → Claude plan should show the engine on and the
worker host, and it should not ask for a Claude credential.

Then follow the [smoke test](../claude-subscription.md#manual-smoke-test).
