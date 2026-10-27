---
"@tiny-agents/agent": patch
---

`browser_type` inserts the whole string in one step, after a real click moves keyboard focus into the page. It used to send one key event per character, which on the VM's CDP link timed out and could land in Chrome's address bar instead of the field. A click or a text field is one round trip that scrolls the target into view; date, color, range and select fields are written in that same call. The retrying Playwright click runs only when something covers the element. Scrolling parks the cursor in the page before the wheel event.
