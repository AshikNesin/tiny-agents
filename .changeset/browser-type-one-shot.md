---
"@tiny-agents/agent": patch
---

`browser_type` inserts the whole string in one step, after a real click moves keyboard focus into the page. It used to send one key event per character, which on the VM's CDP link timed out and could land in Chrome's address bar instead of the field. Clicks now go through Playwright's locator click, so an off-screen element is scrolled into view and the click is retried until that element can receive it. Scrolling parks the cursor in the page before the wheel event.
