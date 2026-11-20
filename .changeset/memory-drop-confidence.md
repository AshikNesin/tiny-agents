---
"tiny-agents": patch
---

Memory: capture no longer asks the model for a confidence score on each memory, since nothing used it. The memories API drops the always-unused `confidence` field.
