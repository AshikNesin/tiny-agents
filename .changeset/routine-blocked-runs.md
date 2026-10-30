---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Routines that can't do their job now say so instead of "succeeded". A run
whose tool call was refused (nobody is there to approve it or type a sign-in),
or that reports itself blocked (new `report_routine_blocked` tool, offered only
in routine runs; routine conversations are told when to use it), is recorded
as "needs attention" with the reason, on the Routines page and in the chat's
run card. After three blocked runs in a row the routine pauses itself, the card
says "Paused after 3 blocked runs: <reason>", and one notification goes out for
the whole streak (blocked runs before that stay quiet). Resuming starts the
count over, and any run that finishes normally resets it. Adds
`Routine.blockedStreak` and `Routine.pausedReason` (migration
`20261030160000_routine_blocked_runs`).
