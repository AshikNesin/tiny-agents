---
"tiny-agents": patch
---

Chat messages rendered inline Markdown links as raw text on Android when the target was a relative path such as `/code/t/<id>`. The renderer now links any `[text](target)`, and tapping a same-server path opens the matching screen in the app (web navigates client-side too) instead of a full page load.
