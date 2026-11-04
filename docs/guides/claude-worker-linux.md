# Claude Code worker on Linux

> **Optional.** With a sandbox configured you do not need this page: the
> app installs and runs the worker on the sandbox itself
> ([Claude subscription](../claude-subscription.md)). Follow it only to run
> the worker on a separate machine, then set `CLAUDE_WORKER_URL` and
> `CLAUDE_WORKER_TOKEN`, which take precedence.

Same rules as the [macOS guide](claude-worker-macos.md): the worker is a
normal user on a Linux VM, loopback only, published with
`tailscale serve`, and tiny-agents never holds the Claude login.

Claude Code on Linux stores the login in the user's config directory.
A systemd **user** unit with linger keeps that home available after
logout. Do not use a system unit running as root.

## 1. The machine

Install Tailscale, tag the node `tag:claude-worker`, and tag the
tiny-agents host `tag:tiny-agents`. The grant is the same as on macOS:
`tag:tiny-agents` may open `tcp:443` on `tag:claude-worker`, and nothing
else may.

## 2. Claude Code

```sh
npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk
claude auth login
claude auth status
```

`loggedIn` must be true and `subscriptionType` must be set. For a
headless user, `claude setup-token` in this same account is the
alternative. If Claude Code needs `CLAUDE_CODE_OAUTH_TOKEN`, put it only
in the 0600 env file below. Do not set `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, or a Bedrock, Vertex, or
Foundry flag. The worker exits if those are present.

## 3. systemd --user

```sh
umask 077
mkdir -p ~/.config/tiny-agents ~/.config/systemd/user
openssl rand -base64 32 > ~/.config/tiny-agents/claude-worker.token
cat > ~/.config/tiny-agents/claude-worker.env <<EOF
CLAUDE_WORKER_TOKEN=$(cat ~/.config/tiny-agents/claude-worker.token)
CLAUDE_WORKER_PORT=8765
EOF
chmod 600 ~/.config/tiny-agents/claude-worker.env
cp deploy/claude-worker/claude-worker.service ~/.config/systemd/user/claude-worker.service
# Edit the unit so ExecStart and WorkingDirectory match this clone.
systemctl --user daemon-reload
systemctl --user enable --now claude-worker.service
loginctl enable-linger "$USER"
```

The unit sets `Restart=always`. Linger lets it run without a logged-in
seat. Confirm the socket:

```sh
ss -ltnp | grep 8765
```

The local address must be `127.0.0.1:8765`.

## 4. Tailscale and tiny-agents

```sh
tailscale serve --bg --yes 8765
tailscale serve status
```

Not Funnel. On the tiny-agents host set `CLAUDE_CODE_ENGINE_ENABLED=1`,
`CLAUDE_WORKER_URL=wss://<node>.<tailnet>.ts.net`, and the same
`CLAUDE_WORKER_TOKEN`. Restart tiny-agents only. Then run the
[smoke test](../claude-subscription.md#manual-smoke-test).
