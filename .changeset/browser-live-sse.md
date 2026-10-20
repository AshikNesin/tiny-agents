---
"@groot/core": patch
"@tiny-agents/agent": patch
---

Browser live view: serve frames over SSE instead of MJPEG. multipart/
x-mixed-replace in an <img> does not survive reverse proxies — Cloudflare
(in front of the production deploy) buffers or reshapes it and the panel
stays black even though the browser session is healthy. The live route now
emits `event: frame` SSE messages (base64 JPEG) — the same transport the
chat feed already streams through — and BrowserPanel paints each frame
into the viewport <img> as a blob URL. Verified end-to-end against the
sandbox VM chromium: first frame ~56ms after connect.
