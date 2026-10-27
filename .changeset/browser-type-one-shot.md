---
"@tiny-agents/agent": patch
---

`browser_snapshot` reads Playwright's accessibility snapshot, and click and type act on those refs. `browser_type` replaces a field in one step. A text field is clicked first so the text lands in the page on the VM's Chrome; date, color, range and select fields are filled directly. It used to send one key event per character, which timed out on the VM link and could land in the address bar.
