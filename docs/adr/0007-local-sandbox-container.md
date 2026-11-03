# ADR 0007: A local sandbox container for machines off the tailnet

- Status: **accepted**
- Date: 2026-11-02

## Context

Everything bots do outside the app (commands, the browser, the computer, the
terminal) runs on the sandbox VM, reached over keyless Tailscale SSH: the
tailnet's `accept` rules are the identity check and ssh2 sends no
credentials. A machine that can't join the tailnet (an office laptop) can run
the app but gives its bots none of those capabilities: without
`SANDBOX_HOST` the computer and terminal are off and the browser falls back
to a headless local Chromium with no live view.

## Decision

- The sandbox can be a **local Docker container** (`docker/sandbox/`): Debian
  13, user `exedev` with passwordless sudo, sshd, tmux, and the browser and
  computer stacks preinstalled with the installers' markers. `pnpm
  sandbox:up` creates a key pair, builds and starts it.
- The shared SSH dial (`packages/agent/src/ssh/connection.ts`) takes an
  optional `privateKey`. With one, it uses public-key auth; without one,
  nothing changes. The app reads it from `SANDBOX_SSH_KEY_FILE` or
  `SANDBOX_SSH_KEY`, next to `SANDBOX_HOST`.
- No toolkit code changes: the container is another address behind the same
  endpoint, so every toolkit, live view and takeover works unchanged.

## Consequences

- Without Tailscale, the key is the identity check, so sshd takes only that
  key, and compose publishes the port on 127.0.0.1 only.
- The image builds for the host's architecture. Google Chrome has no Linux
  arm64 build, so on Apple Silicon the browser is Debian's Chromium behind
  the same `google-chrome-stable` name (the reason for Debian over Ubuntu,
  whose Chromium is a snap). Running the amd64 image emulated instead broke
  native tools: Docker's QEMU emulation has no AVX.
- Chrome runs with `--no-sandbox` in the container (Docker's default seccomp
  profile denies its user namespaces); the container is the boundary.
- Confined commands (vault secrets in `run_command`, `SANDBOX_EGRESS_ALLOWLIST`)
  need systemd, which the container doesn't run; they fail there with a
  systemd error.
- The image's package lists copy the installers'; a test fails when they
  drift. A drifted image still works, the app just installs the difference
  over SSH.

## Alternatives considered

- **`none` auth in the container** (sshd with empty passwords), so the app
  needs no change: any local process could then take a root-capable shell,
  and the port would need to be guarded some other way. Rejected.
- **systemd as PID 1 in the container**, for confined commands: needs a
  privileged or cgroup-mounted container that behaves differently across
  Docker Desktop, OrbStack and Linux. Deferred until someone needs it.
- **Running the app inside the container too**: the app already runs fine on
  the host; one container for the sandbox keeps the app's dev loop unchanged.
