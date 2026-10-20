---
"@tiny-agents/agent": minor
"@groot/core": patch
---

Browser as a first-class bot capability (issue #24): a `browser` toolkit
with seven gated tools (`browser_navigate`, `browser_snapshot`,
`browser_click`, `browser_type`, `browser_press_key`, `browser_scroll`,
`browser_screenshot`) driving one Chromium persistent context per bot
profile (in-process Playwright, no debug port). The web app gains
`/bots/:id/browser` routes: an MJPEG live view over a plain streaming
response (JWT-cookie `<img>`, no WebSocket), a POST input channel that
injects mouse/key events through the same CDP session the agent uses, a
driver flag for takeover (action tools wait while the human drives; a
masked secret field sends keystrokes straight into the page so values
never enter model context, logs, or the transcript), and a profile-reset
endpoint. Client: BrowserPanel docked beside the chat with live view,
driver badge, take-control/release, and the masked field. `@groot/core`:
the compression filter now also skips `multipart/x-mixed-replace` so the
MJPEG stream is never buffered.
