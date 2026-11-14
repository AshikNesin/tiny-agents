#!/usr/bin/env bash
# Full pass: every journey on fresh runs, in parallel, each group up -> doctor -> drive -> down,
# plus a smoke group against the production build (--prod).
# Groups run in parallel to save time (`up` lifts the auth rate limit with
# AUTH_RATE_LIMIT_MAX, so any group could share an instance); the sandbox
# group needs `pnpm sandbox:up`. Logs: data/verify-evidence/full-pass-<time>/<run>.log
#   .agents/skills/verify-tiny-agents/scripts/full-pass.sh [--no-infra] [--aria save|check]
# --no-infra runs only the groups that need no sandbox, Shelley or Cloudflare
# keys (the rewrite's definition of done runs it; docs/rewrite/PLAN.md).
# --aria save|check runs those on frozen-clock instances (`up --fixed-clock`),
# without the two journeys that wait for a scheduled fire, then saves or
# checks every journey's ARIA snapshots against goldens/ (aria-goldens.mjs).
set -u
NO_INFRA=0
ARIA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-infra) NO_INFRA=1 ;;
    --aria) ARIA="$2"; NO_INFRA=1; shift ;;
  esac
  shift
done
FIXED=""
[ -n "$ARIA" ] && FIXED="--fixed-clock"
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
S=.agents/skills/verify-tiny-agents
J=$S/journeys
TAG=$(date -u +%Y%m%d-%H%M%S)
OUT=data/verify-evidence/full-pass-$TAG

GROUP_A="auth account-shell command-palette settings notifications passkeys tasks"
GROUP_B="chats past-chats chat-attachments message-steering questions bot-settings memory message-paging"
GROUP_C="tool-permissions yolo self-improve bot-builder auto-review bot-to-bot shared-bots routines"
GROUP_D="skills connections vault models storage jobs jobs-admin"
# The two scheduled-routine journeys each wait ~2 min for a fire: their own group.
GROUP_E="vault-passkey routine-schedule workflow-e2e"
GROUP_SBX="terminal computer browser code claude-plan bot-profiles code-extras code-select bot-delete"
# Real Cloudflare AI Gateway keys (env:CLOUDFLARE_*): they skip without them.
GROUP_KEYS="models-gateway models-gateway-custom"
GROUP_EMPTY="setup"
# Also driven against the production build (--prod). Not part of the
# exactly-once check below: these journeys run twice, dev server and bundle.
PROD_SMOKE="auth chats tasks settings storage"

# Every journey must be in exactly one group: a new journey not listed here fails loudly.
listed=$(echo $GROUP_A $GROUP_B $GROUP_C $GROUP_D $GROUP_E $GROUP_SBX $GROUP_KEYS $GROUP_EMPTY | tr ' ' '\n' | sort)
present=$(ls "$J" | sed 's/\.mjs$//' | sort)
if [ "$listed" != "$present" ]; then
  echo "full-pass: groups and journeys/ disagree; update the GROUP_* lists:" >&2
  diff <(echo "$listed") <(echo "$present") >&2
  exit 2
fi

mkdir -p "$OUT"

pass() { # run-id port up-flags journeys...
  local id=$1 port=$2 flags=$3; shift 3
  local files=(); for j in "$@"; do files+=("$J/$j.mjs"); done
  {
    $S/scripts/ta-verify.mjs up --port "$port" --run "$id" $flags 2>&1 | grep -E "READY|FAIL"
    $S/scripts/ta-verify.mjs doctor --run "$id" | tail -1
    $S/scripts/ta-verify.mjs drive "${files[@]}" --run "$id" 2>&1 \
      | grep -E "^(PASS|FAIL|UNREACHABLE)|journeys passed|^\s+FAIL"
    $S/scripts/ta-verify.mjs down --run "$id" | tail -1
  } > "$OUT/$id.log" 2>&1
}

pass "$TAG-a" 3300 "$FIXED" $GROUP_A &
pass "$TAG-b" 3310 "$FIXED" $GROUP_B &
pass "$TAG-c" 3320 "$FIXED" $GROUP_C &
pass "$TAG-d" 3330 "$FIXED" $GROUP_D &
# A frozen clock never reaches a scheduled slot: those two need real time.
if [ -n "$ARIA" ]; then pass "$TAG-e" 3370 "$FIXED" vault-passkey &
else pass "$TAG-e" 3370 "" $GROUP_E &
fi
if [ "$NO_INFRA" = 0 ]; then
  pass "$TAG-sbx" 3280 "--sandbox --shelley" $GROUP_SBX &
  pass "$TAG-keys" 3380 "" $GROUP_KEYS &
fi
pass "$TAG-empty" 3340 "--empty $FIXED" $GROUP_EMPTY &
[ -z "$ARIA" ] && pass "$TAG-prod" 3360 "--prod" $PROD_SMOKE &
wait

for log in "$OUT"/*.log; do echo "=== $(basename "$log" .log)"; cat "$log"; done
echo "Every journey should pass: a failure is a regression or a new bug (features/README.md)."
if [ -n "$ARIA" ]; then
  status=0
  for dir in data/verify-evidence/"$TAG"-*; do
    $S/scripts/aria-goldens.mjs "$ARIA" "$dir" || status=1
  done
  exit $status
fi
