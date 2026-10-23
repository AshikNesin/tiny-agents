---
"@groot/web": patch
---

Leaving a skill page with unsaved edits now asks first ("Keep editing" /
"Discard") for sidebar links, the ⌘K palette and browser back, and closing
or reloading the tab gets the browser's leave prompt. The app now runs on a
data router so pages can hold navigation (`LeaveGuard`). Routine run results
show the reply as plain text instead of raw markdown such as `**`.
