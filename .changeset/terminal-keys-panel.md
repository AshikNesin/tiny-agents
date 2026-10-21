---
"@tiny-agents/agent": minor
---

Terminal keys panel + full screen: `/terminal` gains a Termius-style
collapsible keys column (esc/tab/arrows/home/end/pgup/pgdn, ^C ^D ^Z ^L ^R,
sticky ctrl/alt, symbols | \ ~ -, clipboard paste) that writes pty bytes
into the active tab. Below `md` the panel overlays the terminal as a
translucent `w-28` column (phones start collapsed, remembered in
localStorage); at `md+` it docks beside the terminal as a `w-44` column.
Full-screen support (header toggle, `terminal-region` fixed inset-0 with
CSS as the source of truth and the Fullscreen API best-effort, Escape
keyboard lock where supported) and an `onControls` registry so the page can
drive any mounted view without re-rendering on socket lifecycles.
