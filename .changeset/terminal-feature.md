---
"@tiny-agents/agent": minor
---

Terminal capability (issue #28): a `/terminal` page with xterm.js tabs
attached to tmux sessions on the sandbox VM, reached over the same keyless
Tailscale SSH as the sandbox toolkit. Sessions live in tmux on the VM (own
socket, `ta-terminal`), so tabs survive browser closes, network roams,
redeploys and device switches. Server: stateless TerminalService + fresh
ssh2 connection per attached tab (tailscaled stalls multiplexed channels),
single-use ticket WS bridge (binary pty frames, resize control frames,
1000 permanent / 4000 idle / 1011 attach-fail close semantics). Client:
lazy xterm chunk with WebGL-to-DOM fallback, reconnect with fresh tickets,
close-confirm on running processes.
