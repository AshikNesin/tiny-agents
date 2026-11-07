---
"tiny-agents": patch
"@tiny-agents/agent": patch
---

**Test** on a classifier model (Jev, Clef) in Settings → Models now makes one real classify call. It used to try a chat completion and always failed with "The model can't run (missing)", even though auto-review on the same model worked.
