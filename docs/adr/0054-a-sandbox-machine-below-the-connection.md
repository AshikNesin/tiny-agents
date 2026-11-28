# ADR 0054: A sandbox machine below the connection

- Status: **accepted** (amends [0013](0013-one-sandbox-connection.md))
- Date: 2026-11-28

## Context

ADR 0013 builds the one `SandboxConnection` from an SSH endpoint: a host and a
port that are always there. Both sandboxes so far fit that: the exe.dev VM on
the tailnet and the local Docker container (ADR 0007).

An AWS Lambda MicroVM does not. It has to be started or resumed before anyone
can connect, it ends after at most 8 hours, and it takes no TCP connection:
the only way in is an HTTPS endpoint per VM. Each new kind of host would
otherwise reach into the connection's dial, where the pool and the retry
rule live.

## Decision

- `createSandboxConnection` takes a `SandboxMachine`
  (`packages/sandbox/src/ssh/machine.ts`) instead of an endpoint. A machine
  has a `label` (the connection's `host`, named in error text), `ready()`,
  which resolves once the host can take a connection, and `dial()`, which
  returns the SSH endpoint to connect to.
- The connection calls `ready()` then `dial()` wherever it dialed before. The
  ADR 0013 retry rule covers both: a failed attempt is tried once more, except
  for a changed host key.
- `sshMachine(endpoint)` is the machine for a host that is always there. The
  exe.dev VM and the local container use it, so they behave as before.
- SSH stays the one protocol. A machine decides where the bytes go, never
  what runs over them: the pool, channels, SFTP and forwards stay in the
  connection.

## Consequences

- A new kind of host is one new machine; no toolkit, transport or pool code
  changes.
- `ready()` runs before every dial, so a machine keeps it cheap when nothing
  needs doing.
- The deprecated `@tiny-agents/agent/sandbox` subpath keeps its old
  `createSandboxConnection(endpoint, options)` signature by wrapping the
  endpoint in `sshMachine`.

## Alternatives considered

- **An adapter per host with its own exec, file and port API.** Every host
  would reimplement PTYs, SFTP and port forwards, and the retry and wording
  rules 0013 unified would be written once per host.
- **A branch per host inside the dial.** Fewer lines, but host lifecycle and
  cloud SDK calls would live in the SSH module that every deploy loads.
