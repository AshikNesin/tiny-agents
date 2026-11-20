---
"tiny-agents": patch
---

Memory: a bot keeps at most 60 active memories (was 100), so memories of typical length all fit the prompt instead of the oldest quarter being silently left out. Older ones archive as before and can be restored from the Memory page.
