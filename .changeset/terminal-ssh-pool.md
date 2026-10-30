---
"@tiny-agents/agent": patch
"@groot/web": patch
---

Terminal: opening the Terminal page no longer waits about 10 seconds for a
prompt. Every terminal request used to open a fresh SSH connection to the
sandbox (about 2 seconds each over the tailnet, three of them before the first
prompt); listing, tickets and attaches now share one pooled connection that
reconnects on its own and closes after five idle minutes, and getting a ticket
no longer makes an extra round trip. A channel that stalls retires the shared
connection so new work goes to a fresh one. The empty pane says "Connecting to
sandbox…" until the first output arrives.
