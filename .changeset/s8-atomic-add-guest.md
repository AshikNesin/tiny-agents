---
"tiny-agents": patch
---

Adding a guest now creates their account and marks it a guest in one database transaction (security fix, S8). Before, a failure between the two left an account with no guest mark, which the app treats as an owner. A taken email still answers 409.
