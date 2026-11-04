#!/bin/sh
# Keep Shelley's web UI running as exedev on port 9000 (published by
# compose.yml on 127.0.0.1 only). Started in the background by the
# entrypoint; restarts Shelley when it exits. Shelley's own in-UI upgrade
# replaces the binary and re-execs in place, so it keeps the same process.
#
# Which binary: ~/.local/bin/shelley when the owner installed one there (it
# lives on the home volume), else the image's /usr/local/bin/shelley, else
# one is installed into ~/.local/bin now.
set -u

PORT="${SHELLEY_PORT:-9000}"
STATE="$HOME/.config/shelley"
LOG="$STATE/serve.log"
mkdir -p "$STATE" "$HOME/.local/bin"

find_shelley() {
  for candidate in "$HOME/.local/bin/shelley" /usr/local/bin/shelley; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# Provider keys come in as SHELLEY_* so the container's own environment (and
# so sshd, and the Claude worker it starts) never holds an ANTHROPIC_API_KEY;
# only Shelley sees them, under the names it reads. Keys can also be added in
# Shelley's UI, which keeps them in its database.
for name in ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY FIREWORKS_API_KEY; do
  eval "value=\${SHELLEY_${name}:-}"
  if [ -n "$value" ]; then export "$name=$value"; fi
  unset "SHELLEY_${name}"
done
unset value

cd "$HOME"
delay=2
while :; do
  BIN="$(find_shelley)" || {
    echo "$(date -u +%FT%TZ) Shelley not found; installing into ~/.local/bin" >>"$LOG"
    /usr/local/lib/tiny-agents/install-shelley "$HOME/.local/bin/shelley" >>"$LOG" 2>&1 || true
    BIN="$(find_shelley)" || {
      echo "$(date -u +%FT%TZ) Shelley install failed; retrying in 60s" >>"$LOG"
      sleep 60
      continue
    }
  }
  # Keep the log bounded across restarts.
  if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 10485760 ]; then mv -f "$LOG" "$LOG.1"; fi
  echo "$(date -u +%FT%TZ) starting $BIN on :$PORT" >>"$LOG"
  started=$(date +%s)
  "$BIN" -db "$STATE/shelley.db" serve -port "$PORT" </dev/null >>"$LOG" 2>&1
  code=$?
  # Back off when it keeps dying right away; reset after a good run.
  if [ $(($(date +%s) - started)) -gt 60 ]; then delay=2; elif [ "$delay" -lt 60 ]; then delay=$((delay * 2)); fi
  echo "$(date -u +%FT%TZ) Shelley exited ($code); restarting in ${delay}s" >>"$LOG"
  sleep "$delay"
done
