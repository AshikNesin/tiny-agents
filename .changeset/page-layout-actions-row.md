---
"@groot/shell": patch
---

`PageLayout` passes page actions to the new `TopBar` `actions` slot: they
close the title row on desktop and wrap to their own row under it on
phones, instead of squeezing beside a multi-line description. The slot
follows the profile circle in the DOM, so focus order matches the layout.
