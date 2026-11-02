---
"@tiny-agents/agent": patch
---

browser_type on a dropdown now chooses the option whose label or value is
the text. It called Playwright's `fill`, which throws on a <select>, so bots
could not pick an option; the unit test's stub accepted `fill` on a select
and hid it.
