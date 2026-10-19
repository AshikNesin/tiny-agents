---
"@tiny-agents/agent": patch
---

Custom gateway models declare their input modality: `vision: true` opts a model into image input, `vision: false` opts out, and `glm-5.3-flash` defaults to image-capable. pi-ai strips image blocks for models registered text-only ("image omitted: model does not support images"), which broke the see_image side-call in production; the transcriber now also declares image input on its resolved model defensively. Fixes the "I can't view images" replies on non-vision bots.
