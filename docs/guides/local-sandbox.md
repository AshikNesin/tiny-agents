# Local sandbox (no Tailscale)

Bots run commands, browse, use a desktop and open terminal tabs on the
**sandbox VM**, which the app reaches over keyless Tailscale SSH. A machine
that can't join the tailnet (an office laptop, a locked-down network) can run
a **local sandbox** instead: a Docker container with the same user, tools and
desktop stack, reached over plain SSH with a key on `127.0.0.1`.

Nothing else changes. The browser, computer, terminal, sandbox toolkits and
the Claude worker share the same sandbox connection against the container
that they use against the VM, so bots get every capability, live views and
takeover included.

```
App (pnpm dev, on this machine)
  │  SSH, ed25519 key, 127.0.0.1:2222
  ▼
tiny-agents-sandbox container (Debian 13, user exedev, passwordless sudo)
  ├─ run_command / read_file / write_file (exec + SFTP)
  ├─ Terminal tabs: tmux 3.5
  ├─ Browser: Google Chrome (Chromium on arm64) on an Xtigervnc display (CDP + VNC via SSH tunnels)
  ├─ Computer: an XFCE desktop per profile (xdotool, scrot, VNC)
  ├─ Claude Code: Node, the Agent SDK and the CLI, preinstalled for the Claude plan engine
  ├─ CLIs: gh and codex, installed at build time or on the first start
  └─ Shelley: a web-based coding agent, started with the container on 127.0.0.1:9000
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

4. Optional: to let bots answer on your Claude plan, also set
   add the Claude plan account in Settings → Models and sign in from
   Settings → Models → Claude plan.
   Claude Code is already in the image; the login is kept in the `home`
   volume. See [Claude subscription](../claude-subscription.md).

5. Optional: open [Shelley](#shelley) at <http://127.0.0.1:9000> and add a
   model provider, or start the sandbox with `SHELLEY_ANTHROPIC_API_KEY` set.

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

## Shelley

[Shelley](https://github.com/boldsoftware/shelley) is a web-based coding agent
that works in the sandbox directly. The image installs the latest release, and
the container starts it on every start, as `exedev`, at
<http://127.0.0.1:9000>; it is restarted whenever it exits.

- **Which binary:** `~/.local/bin/shelley` when you put one there (it lives on
  the `home` volume, so it survives rebuilds), else the image's
  `/usr/local/bin/shelley`. When neither exists (the download failed at build
  time, or the image was built with `--build-arg INSTALL_SHELLEY=0`), the
  latest release is installed into `~/.local/bin` on start. Every download is
  checked against the release's `checksums.txt`. Shelley's own upgrade button
  works too; `pnpm sandbox:up` after a rebuild brings the image's copy back
  to the release it was built with.
- **Models:** add a provider in Shelley's UI (kept in its database), or set
  keys in the shell before `pnpm sandbox:up`: `SHELLEY_ANTHROPIC_API_KEY`,
  `SHELLEY_OPENAI_API_KEY`, `SHELLEY_GEMINI_API_KEY`,
  `SHELLEY_FIREWORKS_API_KEY`. Only Shelley's process gets them (under their
  usual names); sshd, and so bots' commands and the Claude worker, never do.
- **State:** `~/.config/shelley/` holds its database (`shelley.db`), CLI
  socket and log (`serve.log`); `pnpm sandbox:reset` deletes it with the rest
  of the home volume.
- **Options:** `SANDBOX_SHELLEY_PORT=9001` publishes it on another loopback
  port; `SANDBOX_SHELLEY=0` keeps it from starting; `SANDBOX_SHELLEY_VERSION`
  pins the release tag the image installs (default `latest`).

Shelley has no login of its own, so like SSH it is published on `127.0.0.1`
only. Anyone who can reach that port can run commands as `exedev`.

## gh and codex

The image also installs two command-line tools, for bots' commands and your
own shell (`pnpm sandbox:shell`):

- **gh**, [GitHub's CLI](https://cli.github.com), from GitHub's signed apt
  repository (`gh auth login` once; the login lives on the `home` volume).
- **codex**, [OpenAI's Codex CLI](https://github.com/openai/codex), the
  latest release's binary at `/usr/local/bin/codex` (`codex login` once).

As with Shelley, a failed download doesn't fail the build: on every start the
container checks for both and installs whichever is missing, in the
background, logging to `~/.tiny-agents/install-clis.log`. A copy you put in
`~/.local/bin` counts as installed. `SANDBOX_CODEX_VERSION` pins the Codex
release tag (default `latest`); `--build-arg INSTALL_CLIS=0` leaves both to
the first start; `SANDBOX_CLIS=0` turns off the start-up check.

## Mounting host files

To give bots an SSH key or a working folder from this machine, copy the
example override and edit it:

```bash
cp docker/sandbox/compose.override.example.yml docker/sandbox/compose.override.yml
pnpm sandbox:up
```

`compose.override.yml` is gitignored, and every `pnpm sandbox:*` command
merges it into `compose.yml` when it exists. The example mounts:

```yaml
services:
  sandbox:
    volumes:
      - ${HOME}/.ssh/github:/etc/tiny-agents/ssh/github:ro
      - ${HOME}/work:/home/exedev/work
```

- **SSH files** go under `/etc/tiny-agents/ssh/`, not straight into `~/.ssh`.
  On every start the entrypoint copies each file there into
  `/home/exedev/.ssh/`, owned by `exedev` with mode 600. ssh rejects a key
  that other users can read or that it can't read itself, and a bind mount
  keeps the host file's owner and mode, so mounting the key straight into
  `~/.ssh` often fails. Mount a `config` the same way to choose the key per
  host, for example:

  ```
  Host github.com
    IdentityFile ~/.ssh/github
    IdentitiesOnly yes
  ```

  Because these are copies, a key changed on the host shows up after
  `pnpm sandbox:up` (or a container restart).

- **Folders** such as `~/work` are mounted read-write at their own path, so
  changes go both ways right away. On Linux, files keep the host's numeric
  owner: `exedev` is uid 1000, so a host user with another uid gets read-only
  access unless bots use `sudo`. Docker Desktop, OrbStack and Colima map
  ownership for you.

Docker reads the mounts when it creates the container, so run
`pnpm sandbox:up` again after editing the file.

## How it is put together

- `docker/sandbox/Dockerfile` installs what the app would install on the VM
  on first use (the lists in `browser-vm-setup.ts` and `computer-vm-setup.ts`)
  and leaves the same markers, so the first bot call doesn't wait on apt.
  `tests/server/app/agent/local-sandbox.test.ts` fails when the lists drift.
- `docker/sandbox/compose.yml` publishes SSH and Shelley on **127.0.0.1 only**;
  nothing off this machine can reach them. sshd accepts only `exedev` with the generated key.
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
- **Chromium on Apple Silicon.** The image builds for your machine's
  architecture, so it runs natively everywhere. Google Chrome has no Linux
  arm64 build, so on arm64 (Apple Silicon) the browser is Debian's Chromium,
  started under the same `google-chrome-stable` name the app uses. (An image
  built before this change was amd64 under emulation, where QEMU's lack of
  AVX crashed native tools such as Claude Code's installer; `pnpm sandbox:up`
  rebuilds it natively.)
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
- **"Hash Sum mismatch" / "Failed to fetch" during `pnpm sandbox:up`**: apt
  fetched a `.deb` that disagrees with the package index: a caching proxy on
  the path (a VPN, a corporate network) or a Debian mirror mid-sync served
  stale bytes. The image pins apt to HTTPS mirrors with retries, so this
  should be rare; if a build still fails this way, drop Docker's build cache
  and build again so every layer fetches fresh:

  ```bash
  docker builder prune -f && pnpm sandbox:up
  ```
