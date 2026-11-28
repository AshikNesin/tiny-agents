---
"tiny-agents": patch
---

The browser works again in the local Docker sandbox on Apple Silicon. A sandbox home volume from before the browser stack moved to v2 has no v2 marker, so the app reran the stack install, which stopped on arm64 before checking that the image already has Chromium. The install now checks the architecture only when it has to download Chrome.
