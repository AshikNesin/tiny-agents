---
"@groot/web": patch
---

Friction-audit fixes for the chat and task surfaces:

- The "New messages" divider in a chat now anchors to the first unread
  _assistant_ reply instead of the first unread row, so it no longer sits
  above your own just-sent message.
- The browser panel auto-opens once when the bot runs a `browser_*` tool
  call, so the noVNC view is visible while the agent drives it.
- The composer caps its growth (`max-h-40` + internal scroll) instead of
  pushing the transcript off-screen on long drafts.
- Tool-trace detail blocks scroll internally (`overflow-y-auto`,
  `overscroll-contain`) and expand scrolls the row into view, so long tool
  output no longer hijacks page scroll.
- Chat bubbles use `max-w-[92%]` on mobile / `80%` on desktop with tighter
  gutter padding on small screens.
- The Tasks "Upcoming" quick-add defaults `dueAt` to tomorrow 23:59 so
  tasks land in the tab they were created from; placeholder says so.
- Selects in Routines/Tasks/Memory/Connections render as `popper` dropdowns
  with a height cap.
- The command palette gains Settings navigation, a Theme group
  (Light/Dark/System), and Account actions (Log out).
- Logout from the sidebar account menu or the palette confirms with a toast.
- Light-theme `--fg-tertiary` darkened to #6b6b6b for contrast on the
  light background.
