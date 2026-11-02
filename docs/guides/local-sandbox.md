# Local sandbox (no Tailscale)

Bots run commands, browse, use a desktop and open terminal tabs on the
**sandbox VM**, which the app reaches over keyless Tailscale SSH. A machine
that can't join the tailnet (an office laptop, a locked-down network) can run
a **local sandbox** instead: a Docker container with the same user, tools and
desktop stack, reached over plain SSH with a key on `127.0.0.1`.

Nothing else changes. The browser, computer, terminal and sandbox toolkits use
the same SSH code against the container that they use against the VM, so bots
get every capability, live views and takeover included.

```
App (pnpm dev, on this machine)
  │  SSH, ed25519 key, 127.0.0.1:2222
  ▼
tiny-agents-sandbox container (Ubuntu 24.04, user exedev, passwordless sudo)
  ├─ run_command / read_file / write_file (exec + SFTP)
  ├─ Terminal tabs: tmux 3.4
  ├─ Browser: Google Chrome on an Xtigervnc display (CDP + VNC via SSH tunnels)
  └─ Computer: an XFCE desktop per profile (xdotool, scrot, VNC)
```

## Setup

You need Docker (Docker Desktop, OrbStack, Colima or Docker Engine) and about
3 GB of disk for the image.

1. Start the sandbox. The first run builds the image (a few minutes):

   ```bash
   pnpm sandbox:up
   ```

   It creates an SSH key pair in `data/sandbox/` (gitignored), builds and
   starts the container, checks that SSH answers, and prints the `.env` lines.

2. Point the app at it in `.env`:

   ```
   SANDBOX_HOST=127.0.0.1
   SANDBOX_PORT=2222
   SANDBOX_USER=exedev
   SANDBOX_SSH_KEY_FILE=data/sandbox/id_ed25519
   ```

3. Restart `pnpm dev`. The browser panel, "Open computer" and the Terminal
   page now use the container.

## Everyday commands

| Command              | What it does                                                       |
| -------------------- | ------------------------------------------------------------------ |
| `pnpm sandbox:up`    | Create the key if needed, build, start, wait for SSH               |
| `pnpm sandbox:down`  | Stop the container; files, browser profiles and desktops stay      |
| `pnpm sandbox:logs`  | Follow sshd's log                                                  |
| `pnpm sandbox:shell` | A login shell as `exedev` inside the container                     |
| `pnpm sandbox:reset` | Stop it and delete the bots' home volume (files, profiles, logins) |

The container restarts with Docker (`restart: unless-stopped`).

## Options

- **Another port:** `SANDBOX_LOCAL_PORT=2223 pnpm sandbox:up`, then set
  `SANDBOX_PORT=2223` in `.env`.
- **More apps on the desktop:** `SANDBOX_EXTRA_PACKAGES="libreoffice-calc gimp"
  pnpm sandbox:up` bakes them into the image. `COMPUTER_EXTRA_PACKAGES` in
  `.env` still works too; the app installs those over SSH on first use.
- **The key inline** instead of a file (for an env that can't hold files):
  `SANDBOX_SSH_KEY` takes the private key, with `\n` for newlines.

## How it is put together

- `docker/sandbox/Dockerfile` installs what the app would install on the VM
  on first use (the lists in `browser-vm-setup.ts` and `computer-vm-setup.ts`)
  and leaves the same markers, so the first bot call doesn't wait on apt.
  `tests/server/app/agent/local-sandbox.test.ts` fails when the lists drift.
- `docker/sandbox/compose.yml` publishes SSH on **127.0.0.1 only**; nothing off
  this machine can reach it. sshd accepts only `exedev` with the generated key.
- The `home` volume keeps `/home/exedev` (bots' files, browser profiles,
  desktops) across rebuilds. The `host-keys` volume keeps sshd's host key, so
  the key the app pinned on first connect stays valid.
- Chrome's own sandbox can't create user namespaces under Docker's default
  seccomp profile, so Chrome runs with `--no-sandbox` through a wrapper that
  every launch path uses; the container is the boundary.
- XFCE's "Terminal Emulator" and "Web Browser" launchers are pinned to
  `xfce4-terminal` and Chrome (apt otherwise picks an OpenGL terminal that
  can't start on a VNC display).

## Differences from the VM

- **Confined commands need systemd.** `run_command` with vault `secrets`, and
  every command when `SANDBOX_EGRESS_ALLOWLIST` is set, runs in a transient
  systemd unit (`sandbox-egress.ts`). The container has no systemd, so those
  fail. Leave `SANDBOX_EGRESS_ALLOWLIST` unset with the local sandbox, and use
  the browser's vault fill rather than secrets in commands.
- **amd64 only.** Google Chrome ships for linux/amd64. On Apple Silicon,
  Docker runs the image emulated (Rosetta in Docker Desktop or OrbStack):
  slower to start, fine for normal use.
- **Your network.** The container reaches the internet through Docker's
  network, so a corporate proxy or TLS-inspecting firewall applies to it as it
  does to the host. Bots' commands can reach anything this machine can.

## Troubleshooting

- **"Sandbox host key changed for 127.0.0.1"**: the `host-keys` volume was
  deleted, so the container has a new host key. Forget the pinned one (the
  default dev database shown) and restart the app:

  ```bash
  sqlite3 data/dev.db "DELETE FROM kv WHERE key = 'SANDBOX:127.0.0.1'"
  ```

- **"All configured authentication methods failed"**: `.env` doesn't point at
  the key (check `SANDBOX_SSH_KEY_FILE`; the app logs once when it can't read
  it), or the container was started with another key. Run `pnpm sandbox:up`
  again.
- **The browser or desktop won't start**: `pnpm sandbox:shell`, then look at
  the logs in `~/.tiny-agents/` and the profile directories.
