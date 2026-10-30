---
"@groot/web": patch
---

Browser panel on tablets and small laptops: the panel now sits beside the
chat only on wide screens (1280px and up), and never so wide that the chat
gets less than about 26rem. On narrower screens it opens over the chat with
its close button in reach, like on phones. Before, at 1024px the chat shrank
to a sliver with text wrapping one letter per line, and at 820px the composer
was 32px wide and the panel's close button was off the screen.
