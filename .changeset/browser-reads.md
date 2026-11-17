---
"tiny-agents": minor
---

Browser: bots can now read past the top of a long page. Snapshots are compact (about half Playwright's size, every word kept), come in windows with an `offset` to read on, and narrow to a region (`ref`) or to lines with given words (`query`). New `browser_read_text` reads an article as plain text and `browser_back` goes back. Clicks and Enter that open a page wait for it, so the next read is of the new page. Only the newest two long page reads stay in the model's context.
