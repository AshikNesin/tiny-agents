#!/bin/sh
# Install the command-line tools bots and the owner expect on the sandbox,
# skipping each one that is already there:
#
# - gh, GitHub's CLI (https://cli.github.com), from GitHub's signed apt
#   repository,
# - codex, OpenAI's Codex CLI (https://github.com/openai/codex), as one
#   binary from its GitHub release, at /usr/local/bin/codex.
#
#   install-clis.sh [codex-version]
#
# `codex-version` is a release tag (e.g. rust-v0.60.1) or `latest` (the
# default). Runs as root. The Dockerfile runs this at build time; the
# entrypoint runs it again on every start, in the background, so an image
# built without network still gets the tools on its first start. A tool the
# owner installed in ~/.local/bin counts as installed.
#
# Exits non-zero when a tool is still missing afterwards; each tool is tried
# even when another fails.
set -u

CODEX_VERSION="${1:-latest}"
USER_BIN=/home/exedev/.local/bin

have() {
  command -v "$1" >/dev/null 2>&1 || [ -x "$USER_BIN/$1" ]
}

install_gh() {
  KEYRING=/etc/apt/keyrings/githubcli-archive-keyring.gpg
  mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL --retry 3 -o "$KEYRING.new" https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && mv -f "$KEYRING.new" "$KEYRING" \
    && chmod 644 "$KEYRING" \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=$KEYRING] https://cli.github.com/packages stable main" \
      >/etc/apt/sources.list.d/github-cli.list \
    && apt-get update -qq \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends gh \
    || { rm -rf /var/lib/apt/lists/*; return 1; }
  rm -rf /var/lib/apt/lists/*
  gh --version | head -n 1
}

install_codex() {
  case "$(uname -m)" in
    x86_64 | amd64) TRIPLE=x86_64-unknown-linux-musl ;;
    aarch64 | arm64) TRIPLE=aarch64-unknown-linux-musl ;;
    *) echo "codex: unsupported CPU $(uname -m)" >&2; return 1 ;;
  esac
  if [ "$CODEX_VERSION" = latest ]; then
    BASE="https://github.com/openai/codex/releases/latest/download"
  else
    BASE="https://github.com/openai/codex/releases/download/${CODEX_VERSION}"
  fi
  TMP="$(mktemp -d)"
  if curl -fsSL --retry 3 -o "$TMP/codex.tar.gz" "$BASE/codex-$TRIPLE.tar.gz" \
    && tar -xzf "$TMP/codex.tar.gz" -C "$TMP" \
    && install -m 755 "$TMP/codex-$TRIPLE" /usr/local/bin/codex.new \
    && mv -f /usr/local/bin/codex.new /usr/local/bin/codex; then
    rm -rf "$TMP"
  else
    rm -rf "$TMP"
    return 1
  fi
  codex --version
}

status=0
for tool in gh codex; do
  if have "$tool"; then
    echo "$tool: already installed"
    continue
  fi
  echo "$tool: installing"
  if ! "install_$tool" || ! have "$tool"; then
    echo "$tool: install failed" >&2
    status=1
  fi
done
exit "$status"
