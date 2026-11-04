---
"@tiny-agents/agent": minor
"@tiny-agents/claude-worker": minor
"@groot/web": minor
---

Claude plan: set `CLAUDE_CODE_ENGINE_ENABLED=1`, sign in once, and use it.
The app now installs and runs the Claude Code worker on the sandbox itself
(the VM or the local container) over the same SSH endpoint as the browser and
terminal: Node when needed, the pinned Agent SDK and Claude Code, the bundled
worker (`dist/server/claude-worker.mjs`), started on the sandbox's loopback and
reached through an SSH tunnel — no `tailscale serve`, token or unit file.
Settings → Claude plan shows the setup and login state and opens a terminal tab
running `claude auth login` to sign in (`POST /terminal/sessions` takes
`run: "claude-login"`, the Terminal page takes `?tab=`). The local sandbox image
preinstalls Claude Code. `CLAUDE_WORKER_URL`/`CLAUDE_WORKER_TOKEN` still select a
hand-run worker and win. The worker now starts without a login (each session
checks it), and the launcher unsets API-key and backend overrides. See ADR 0010.
