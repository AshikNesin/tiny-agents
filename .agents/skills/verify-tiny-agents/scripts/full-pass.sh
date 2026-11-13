#!/usr/bin/env bash
# Full pass: every journey on fresh runs, in parallel, each group up -> doctor -> drive -> down,
# plus a smoke group against the production build (--prod).
# Groups run in parallel to save time (`up` lifts the auth rate limit with
# AUTH_RATE_LIMIT_MAX, so any group could share an instance); the sandbox
# group needs `pnpm sandbox:up`. Logs: data/verify-evidence/full-pass-<time>/<run>.log
#   .agents/skills/verify-tiny-agents/scripts/full-pass.sh
set -u
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
GROUP_SBX="terminal computer browser code claude-plan bot-profiles code-extras code-select"
GROUP_EMPTY="setup"
# Also driven against the production build (--prod). Not part of the
# exactly-once check below: these journeys run twice, dev server and bundle.
PROD_SMOKE="auth chats tasks settings storage"

# Every journey must be in exactly one group: a new journey not listed here fails loudly.
listed=$(echo $GROUP_A $GROUP_B $GROUP_C $GROUP_D $GROUP_E $GROUP_SBX $GROUP_EMPTY | tr ' ' '\n' | sort)
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

pass "$TAG-a" 3300 "" $GROUP_A &
pass "$TAG-b" 3310 "" $GROUP_B &
pass "$TAG-c" 3320 "" $GROUP_C &
pass "$TAG-d" 3330 "" $GROUP_D &
pass "$TAG-e" 3370 "" $GROUP_E &
pass "$TAG-sbx" 3280 "--sandbox --shelley" $GROUP_SBX &
pass "$TAG-empty" 3340 "--empty" $GROUP_EMPTY &
pass "$TAG-prod" 3360 "--prod" $PROD_SMOKE &
wait

for log in "$OUT"/*.log; do echo "=== $(basename "$log" .log)"; cat "$log"; done
echo "Every journey should pass: a failure is a regression or a new bug (features/README.md)."
