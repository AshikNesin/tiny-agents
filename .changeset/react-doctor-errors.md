---
"tiny-agents": patch
---

Internal cleanup with no visible change: the vault's sink helpers no longer carry hook-style `use…` names, the chat transcript reads its page source without writing a ref during render, and the multiple-choice selection's merge and split timers now live in an effect that clears them.
