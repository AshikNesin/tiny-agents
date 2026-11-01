---
"@tiny-agents/agent": minor
"@groot/web": minor
---

Computer (issue #108): every bot gets a desktop. With SANDBOX_HOST set, the
first `computer_*` call (or "Open computer") installs XFCE, xdotool, scrot,
xclip and wmctrl on the sandbox VM and starts an XFCE desktop per browser
profile on its own Xtigervnc display, at a fixed size (`COMPUTER_DESKTOP_SIZE`,
default 1280x800). The new `computer` toolkit sees with screenshots and acts
with clicks, keys, typing, drags and scrolls in the same pixels (Anthropic's
computer-use vocabulary): `computer_screenshot`, `computer_zoom`,
`computer_click`, `computer_type`, `computer_key`, `computer_open_app`,
windows, clipboard, `computer_wait`, `computer_request_takeover` and the vault
sink `computer_fill_secret`. Every action answers with a fresh screenshot;
effects ask first, and closing a window, closing shortcuts (alt+F4, ctrl+q,
ctrl+w) and clipboard reads always ask. Typed text, clipboard text and vault
values travel over stdin, never argv, and are never echoed. While the owner
drives, actions wait and screenshots are refused. A bot can ask the owner to
take over: the chat shows an "Action needed" card, the owner is notified, and
the bot resumes from a screenshot once they hand back. A desktop left by a
crash is reattached; one that died is relaunched on the next call.

The chat gains a Computer panel (noVNC, scaled, never resized; take control,
paste, full screen, reset) beside the Browser panel, routes
`GET /bots/:id/computer`, `POST /bots/:id/computer/start|vnc-ticket|driver`
and `DELETE /bots/:id/computer/profile`, and a `/bots/:id/computer/vnc`
WebSocket; the browser's VNC bridge is now shared (`desktop.vnc.ts`). New
chat tool status `awaiting_takeover`, vault target kind `window` (every use
asks), and logins list `computer_fill_secret` by default. New optional env:
`COMPUTER_DESKTOP_SIZE`, `COMPUTER_IDLE_MINUTES`, `COMPUTER_EXTRA_PACKAGES`.
Without SANDBOX_HOST nothing changes: no tools offered, no panel toggle.
