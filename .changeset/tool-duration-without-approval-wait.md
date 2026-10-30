---
"@tiny-agents/agent": patch
"@groot/web": patch
---

A tool's run time no longer includes the time it waited for your approval.
Opening a page you approved after a minute and a half used to read "117.2s";
it now reads the tool's own time with the wait beside it, e.g.
"15.1s · waited 1m 40s for you".
