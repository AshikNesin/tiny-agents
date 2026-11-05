---
"@tiny-agents/agent": minor
"@groot/web": patch
---

One sandbox connection. Everything that reaches the sandbox VM (or the local
sandbox container) now goes through one `SandboxConnection`
(`createSandboxConnection(endpoint)`), built once in the app's composition
root (`sandboxConnection()` in `sandbox-host.ts`) and handed to the sandbox
toolkit, attachments, the terminal, the computer, the browser and the Claude
worker. Its interface is `exec(cmd, { stdin, timeoutMs, maxBytes,
settleOnExit })`, `pty(cmd, size)`, `readFile`, `writeFile`, `forward(port)`
and `close()`. Behind it: one channel pool with a lazy shared dial, the
defaults, TOFU host keys (unchanged), the pre-dispatch-only retry rule, the
idle close (5 minutes), a closed forward retiring its connection (tailscaled
stalls later channels on it), and one "Cannot reach the sandbox" wording.
Attachments, the Claude worker, the computer's tool calls and the browser's
setup and tunnels no longer pay a fresh SSH handshake per call or per socket.

**Breaking** (`@tiny-agents/agent`): the toolkits and transports take
`{ connection }` instead of host, port, user, host keys and key; the removed
exports are `createSsh2Transport`, `SandboxTransport`, `SandboxSession`,
`createSsh2TerminalTransport`, `Ssh2TerminalTransport(Options)`,
`TerminalTransport` (now `TerminalConnection`) and `dialSsh`;
`createSandboxClaudeWorker` takes `connection` instead of `endpoint` and
`dial`.
