---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Browser: full-control live view. With SANDBOX_HOST set, each bot's Chrome now
runs headful on a private VNC display on the VM (installed automatically on
first use) and the browser panel streams it with noVNC: real Chrome UI, mouse
and keyboard, tabs, clipboard sync, full screen, a draggable panel width and a
Retina-sharp canvas that fits its box. Taking control and releasing it keep
the agent on whichever tab the owner left in front. VNC and CDP stay on
127.0.0.1 on the VM; the WebSocket is guarded by one-time tickets. Deploys
without SANDBOX_HOST get a headless browser for the bot and a panel that says
there is no live view. Removed: the JPEG screencast and its `GET /browser/live`
and `POST /browser/input` routes. New: `BROWSER_SCALE`,
`POST /browser/start|vnc-ticket|resize`.
