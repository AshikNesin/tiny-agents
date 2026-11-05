#!/bin/sh
# Prepare sshd and run it in the foreground.
#
# - The host key lives on a volume, so the app's pinned key (TOFU) survives
#   `docker compose up --build`; it is generated on the first start.
# - The app's public key is bind-mounted read-only by compose.yml; it is
#   copied to a root-owned file because sshd refuses keys whose file the
#   host user owns (StrictModes).
set -eu

KEY=/etc/ssh/host-keys/ssh_host_ed25519_key
if [ ! -f "$KEY" ]; then
  ssh-keygen -q -t ed25519 -N "" -C tiny-agents-sandbox -f "$KEY"
fi

SRC=/etc/tiny-agents/authorized_keys
if [ ! -s "$SRC" ]; then
  echo "No public key at $SRC: run \`pnpm sandbox:up\`, which creates data/sandbox/id_ed25519.pub." >&2
  exit 1
fi
install -m 644 -o root -g root "$SRC" /etc/ssh/authorized-keys/exedev

# The X socket dir must be world-writable for each profile's display.
mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
# A home volume created before the image changed keeps its own ownership.
chown exedev:exedev /home/exedev

# SSH files from the host (compose.override.yml mounts them under
# /etc/tiny-agents/ssh): copied into ~/.ssh owned by exedev with mode 600, as
# ssh requires, whatever their owner and mode on the host. Copied again on
# every start, so a changed host file arrives with a restart.
SSH_DIR=/home/exedev/.ssh
mkdir -p "$SSH_DIR"
chown exedev:exedev "$SSH_DIR"
chmod 700 "$SSH_DIR"
if [ -d /etc/tiny-agents/ssh ]; then
  for f in /etc/tiny-agents/ssh/* /etc/tiny-agents/ssh/.[!.]*; do
    if [ -f "$f" ]; then
      install -m 600 -o exedev -g exedev "$f" "$SSH_DIR/$(basename "$f")"
    fi
  done
fi

# The prerequisite CLIs (gh, codex): checked on every start and installed
# when missing, e.g. when the image was built without network. In the
# background, so sshd isn't held up; the log is install-clis.log in exedev's
# ~/.tiny-agents. SANDBOX_CLIS=0 skips the check.
if [ "${SANDBOX_CLIS:-1}" != 0 ]; then
  CLIS_LOG=/home/exedev/.tiny-agents/install-clis.log
  mkdir -p /home/exedev/.tiny-agents
  touch "$CLIS_LOG"
  chown exedev:exedev /home/exedev/.tiny-agents "$CLIS_LOG"
  /usr/local/lib/tiny-agents/install-clis "${SANDBOX_CODEX_VERSION:-latest}" </dev/null >>"$CLIS_LOG" 2>&1 &
fi

# Shelley's web UI (shelley-run installs it first when the image has none),
# as exedev, restarted when it exits. SANDBOX_SHELLEY=0 turns it off. The
# provider keys (SHELLEY_*_API_KEY) are handed to it and then dropped from
# this shell, so sshd's sessions never see them.
if [ "${SANDBOX_SHELLEY:-1}" != 0 ]; then
  runuser -u exedev -- env HOME=/home/exedev USER=exedev LOGNAME=exedev SHELL=/bin/bash \
    PATH=/home/exedev/.local/bin:/usr/local/bin:/usr/bin:/bin \
    /usr/local/lib/tiny-agents/shelley-run </dev/null >/dev/null 2>&1 &
fi
unset SHELLEY_ANTHROPIC_API_KEY SHELLEY_OPENAI_API_KEY SHELLEY_GEMINI_API_KEY SHELLEY_FIREWORKS_API_KEY

exec /usr/sbin/sshd -D -e
