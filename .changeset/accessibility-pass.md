---
"@groot/web": patch
---

Accessibility fixes from an axe-core pass; every page now scans clean in light
and dark mode. The Jobs page's icon buttons (row actions, the extra job states
menu) have names, its state filter no longer puts a menu inside the tab list
or points at tab panels that do not exist, and the Storage page's icon buttons
and select column are labelled. Red status text (failed, error, expired badges)
and blue folder names now meet 4.5:1 contrast in both themes. The chat page has
a top-level heading (the bot's name), Settings headings no longer skip a level,
the composer hint and the new row and message times are readable, and the
feedback form's type buttons have names.
