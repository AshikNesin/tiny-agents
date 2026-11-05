# ADR 0013: One sandbox connection

- Status: **accepted** (amends the tunnel in [0010](0010-claude-worker-runs-on-the-sandbox.md))
- Date: 2026-11-05

## Context

The app resolves one SSH endpoint for the sandbox VM (or the local sandbox
container, ADR 0007) and handed it to six users: the sandbox toolkit,
attachments, the terminal, the computer, the browser and the Claude worker.
Each unpacked it and chose its own reuse, retry and timeout policy. The
sandbox toolkit cached one session and retried by hand, the terminal had the
only channel pool (issue #84), and attachments, the Claude worker, the
computer's tool calls and the browser's setup and tunnels dialed a fresh
connection for every call or socket, about 2 s of tailnet handshake each.
The rule "only retry a failure from before dispatch" was written twice, the
defaults three times, and five copies of exec-and-collect each worded errors
their own way.

The fresh dials came from a tailscaled finding (verified live, recorded in
the browser feature doc): after a direct-tcpip channel closes, later channels
on the same connection stall.

## Decision

- Everything that reaches the sandbox goes through one `SandboxConnection`
  (`packages/agent/src/ssh/sandbox-connection.ts`), built once from the
  endpoint in the app's composition root (`sandboxConnection()` in
  `sandbox-host.ts`) and closed last at shutdown. Its interface: `exec(cmd,
  { stdin, timeoutMs, maxBytes, settleOnExit })`, `pty(cmd, size)`,
  `readFile`, `writeFile`, `forward(port)` and `close()`. Toolkits,
  transports and the Claude worker take the connection, never an endpoint.
- Behind it: one channel pool with a lazy shared dial and an idle close
  (5 minutes with no open channel), the defaults, TOFU host keys as before,
  and one wording for "Cannot reach the sandbox".
- The retry rule, written once: a failed dial is redialed once (not a
  changed host key); a refused channel never ran anything, so it retires its
  connection and is retried once on a fresh one; a channel that does not
  open within 10 s retires its connection and surfaces for an exec or pty
  (it might have run) but is retried for SFTP and forwards (nothing runs);
  anything after dispatch surfaces.
- The tailscaled finding is kept as a pool rule instead of a fresh dial per
  socket: when a forward closes, its connection is retired. Channels already
  open on it (a terminal tab, the CDP websocket, a VNC stream) carry on, and
  new channels go to a fresh connection. A forward to a port nothing listens
  on is refused without retiring anything.

## Consequences

- Attachments, the Claude worker, the computer's tool calls and the
  browser's setup share the warm connection instead of paying a handshake
  per call; a forward costs a dial only after one has closed.
- A dropped connection takes every channel on it down at once (terminal
  tabs, live views, the CDP link). Each of those already reconnects, and the
  next call redials.
- OpenSSH caps session channels per connection (`MaxSessions`, 10 by
  default, in the local container). A refusal past the cap retires the
  connection and the call goes to a fresh one, so many open terminal tabs
  spread over a few connections.
- Connection bugs are fixed in one module, tested once against the
  in-process SSH server; toolkit and transport tests use an in-memory
  connection.

## Alternatives considered

- **A fresh connection per forward, the pool for everything else.** Keeps
  the old tunnel behaviour exactly, but leaves two policies and the dial per
  socket. Retiring on close keeps the tailscaled workaround with one policy.
- **Keep per-consumer policies and share only the dial.** The duplicated
  retry and wording rules are what drifted; sharing the dial alone would not
  remove them.
