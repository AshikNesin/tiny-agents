---
"tiny-agents": patch
"@tiny-agents/sandbox": patch
---

The sandbox browser sends all of its traffic through a proxy that resolves each name once, refuses private and local answers, and connects to the address it checked, so DNS rebinding can't reach a private host. It runs in the server for the local browser and next to Chrome on the sandbox VM, and covers a page's own requests too. In the live view, a private or tailnet address now opens only when it is in `BROWSER_ALLOWED_PRIVATE_HOSTS`.
