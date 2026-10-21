---
"@groot/ui": patch
---

Fix dialogs growing wider than the viewport when their content has an unbreakable line (for example a code block in the skill import preview). `DialogContent` now uses a `minmax(0, 1fr)` grid column so children shrink and scroll instead of stretching the dialog.
