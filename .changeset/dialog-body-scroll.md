---
"@groot/ui": patch
"@groot/web": patch
---

Tall dialogs keep their header, tabs and footer pinned and scroll only the middle. `DialogContent` is now a height-capped flex column and `@groot/ui/dialog` exports a `DialogBody` scroll region; the bot, routine, skill import/create and connection dialogs use it.
