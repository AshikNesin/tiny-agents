---
"tiny-agents": minor
---

Code projects go further. Every commit a project thread makes carries a `Thread-Id` trailer that leads back to the conversation. Each turn is checkpointed, so Changes can show what any one turn changed, and Revert to here puts the files back without touching the branch's history. In the PR tab, Auto-merge turns on GitHub's own auto-merge once no fix is running, a spend limit pauses Auto-fix when a thread has cost enough, each pass shows what it cost, and queued PRs say so. Projects can also run a final check when checks go green, and fix a PR the merge queue removed. Optionally, set up a GitHub App (Projects → GitHub): its projects use short-lived tokens, and signed webhooks bring each check within seconds instead of polling.
