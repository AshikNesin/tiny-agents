#!/bin/sh
# Install Shelley (https://github.com/boldsoftware/shelley), the web-based
# coding agent, as one binary at $1 (default /usr/local/bin/shelley).
#
#   install-shelley.sh [target] [version]
#
# `version` is a release tag (e.g. v0.1595.922530536) or `latest` (the
# default). The download is checked against the release's checksums.txt.
# The Dockerfile runs this at build time; the entrypoint runs it again on
# start when no Shelley is found, so an image built without network or a
# home volume that lost its copy still gets one.
set -eu

TARGET="${1:-/usr/local/bin/shelley}"
VERSION="${2:-latest}"

case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "Shelley: unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac
ASSET="shelley_linux_${ARCH}"

if [ "$VERSION" = latest ]; then
  BASE="https://github.com/boldsoftware/shelley/releases/latest/download"
else
  BASE="https://github.com/boldsoftware/shelley/releases/download/${VERSION}"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL --retry 3 -o "$TMP/$ASSET" "$BASE/$ASSET"
curl -fsSL --retry 3 -o "$TMP/checksums.txt" "$BASE/checksums.txt"
EXPECTED="$(awk -v a="$ASSET" '$2 == a { print $1 }' "$TMP/checksums.txt")"
ACTUAL="$(sha256sum "$TMP/$ASSET" | awk '{ print $1 }')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Shelley: checksum mismatch for $ASSET (expected '${EXPECTED}', got '${ACTUAL}')" >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET")"
install -m 755 "$TMP/$ASSET" "$TARGET.new"
mv -f "$TARGET.new" "$TARGET"
"$TARGET" version
