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

exec /usr/sbin/sshd -D -e
